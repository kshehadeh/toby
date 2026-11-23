import Foundation
import Security

/// Toby's secrets (OpenRouter key, Mail, Slack, sync password, …) in **one**
/// login-Keychain item owned by the running build, read once per launch.
///
/// Why one item: macOS asks permission per item whenever a different build
/// (Dev vs release, or the old daemon) created it. One item that this build
/// creates itself never prompts. Dev builds use a separate item
/// (`app.toby.dev`) so they never write entries the release app must ask for.
///
/// Older per-field items are migrated once with Keychain UI disabled: values
/// macOS releases without asking are copied; anything that would need a
/// prompt is skipped (the user reconnects that source instead).
public final class TobyKeychain: @unchecked Sendable {
	/// Test processes get an in-memory vault so they never touch the real Keychain.
	public static let shared = isTestProcess
		? TobyKeychain(service: "app.toby.tests", backend: MemoryKeychain())
		: TobyKeychain(service: scopedService("app.toby"), backend: SystemKeychain())

	static var isTestProcess: Bool {
		let info = ProcessInfo.processInfo
		if info.environment["XCTestConfigurationFilePath"] != nil || info.environment["XCTestSessionIdentifier"] != nil { return true }
		let name = info.processName.lowercased()
		if name.contains("xctest") || name.contains("swiftpm-testing-helper") || name.hasSuffix("packagetests") { return true }
		return NSClassFromString("XCTestCase") != nil || info.arguments.contains { $0.hasSuffix(".xctest") || $0.contains("--testing-library") }
	}

	/// `app.toby` for release builds, `app.toby.dev` for `….dev` bundles.
	public static func scopedService(_ base: String, bundleID: String? = Bundle.main.bundleIdentifier) -> String {
		(bundleID?.hasSuffix(".dev") ?? false) ? base + ".dev" : base
	}

	/// Where pre-vault builds kept each secret: (service, account) → vault key.
	/// An account of `nil` means "every account in the service, same name".
	public static let legacySources: [(service: String, account: String?, key: String?)] = [
		("app.toby.secrets", nil, nil),
		("app.toby.openrouter", "api-key", "openrouter.apiKey"),
		("dev.toby.sync", "vault-passphrase", "sync.passphrase"),
	]

	static let account = "secrets"

	let service: String
	let backend: any KeychainBackend
	private let lock = NSLock()
	private var cache: [String: String]?

	/// Legacy entries macOS wouldn't release without a prompt (left in place).
	public private(set) var skippedLegacyKeys: [String] = []

	public init(service: String, backend: any KeychainBackend) {
		self.service = service
		self.backend = backend
	}

	public func value(_ key: String) -> String? {
		lock.withLock { loadLocked()[key] }
	}

	public func set(_ value: String?, for key: String) throws {
		try lock.withLock {
			var values = loadLocked()
			if let value, !value.isEmpty { values[key] = value } else { values.removeValue(forKey: key) }
			try persistLocked(values)
			cache = values
		}
	}

	/// Drop the in-memory copy (tests, or after another process wrote).
	public func reset() { lock.withLock { cache = nil } }

	private func loadLocked() -> [String: String] {
		if let cache { return cache }
		var values: [String: String] = [:]
		if let data = try? backend.read(service: service, account: Self.account),
		   let decoded = try? JSONDecoder().decode([String: String].self, from: data) {
			values = decoded
		} else {
			(values, skippedLegacyKeys) = migrateLegacy()
			try? persistLocked(values)
		}
		cache = values
		return values
	}

	private func persistLocked(_ values: [String: String]) throws {
		let encoder = JSONEncoder()
		encoder.outputFormatting = .sortedKeys
		try backend.write(try encoder.encode(values), service: service, account: Self.account)
	}

	/// Copy older per-field items without ever showing a dialog.
	func migrateLegacy() -> (values: [String: String], skipped: [String]) {
		var values: [String: String] = [:]
		var skipped: [String] = []
		for source in Self.legacySources where source.service != service {
			let accounts = source.account.map { [$0] } ?? backend.accounts(service: source.service).filter { $0 != Self.account }
			for account in accounts {
				let key = source.key ?? account
				switch backend.readSilently(service: source.service, account: account) {
				case let .some(data?):
					if let text = String(data: data, encoding: .utf8), !text.isEmpty { values[key] = text }
				case .some(nil):
					continue // not present
				case nil:
					skipped.append(key) // would need a prompt
				}
			}
		}
		return (values, skipped.sorted())
	}
}

/// Storage behind `TobyKeychain` (the system Keychain, or a fake in tests).
public protocol KeychainBackend: Sendable {
	func read(service: String, account: String) throws -> Data?
	/// `.some(nil)`: no such item; `nil`: exists but needs user approval.
	func readSilently(service: String, account: String) -> Data??
	func write(_ data: Data, service: String, account: String) throws
	func accounts(service: String) -> [String]
}

/// The login Keychain via `SecItem*`.
public struct SystemKeychain: KeychainBackend {
	public init() {}

	static func query(_ service: String, _ account: String) -> [String: Any] {
		[kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
	}

	public func read(service: String, account: String) throws -> Data? {
		var query = Self.query(service, account)
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne
		var item: CFTypeRef?
		let status = SecItemCopyMatching(query as CFDictionary, &item)
		switch status {
		case errSecSuccess: return item as? Data
		case errSecItemNotFound: return nil
		default: throw KeychainError(status: status)
		}
	}

	public func readSilently(service: String, account: String) -> Data?? {
		KeychainInteraction.withoutUI {
			do { return .some(try read(service: service, account: account)) } catch { return nil }
		}
	}

	public func write(_ data: Data, service: String, account: String) throws {
		let status = SecItemUpdate(Self.query(service, account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
		if status == errSecItemNotFound {
			var add = Self.query(service, account)
			add[kSecValueData as String] = data
			add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
			let added = SecItemAdd(add as CFDictionary, nil)
			guard added == errSecSuccess else { throw KeychainError(status: added) }
		} else if status != errSecSuccess {
			throw KeychainError(status: status)
		}
	}

	public func accounts(service: String) -> [String] {
		let query: [String: Any] = [
			kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
			kSecMatchLimit as String: kSecMatchLimitAll, kSecReturnAttributes as String: true,
		]
		var items: CFTypeRef?
		guard SecItemCopyMatching(query as CFDictionary, &items) == errSecSuccess else { return [] }
		return ((items as? [[String: Any]]) ?? []).compactMap { $0[kSecAttrAccount as String] as? String }
	}
}

/// In-memory Keychain (tests). `locked` entries behave like items that would
/// need user approval.
public final class MemoryKeychain: KeychainBackend, @unchecked Sendable {
	private let lock = NSLock()
	private var items: [String: Data] = [:]
	private var locked: Set<String> = []

	public init() {}

	static func key(_ service: String, _ account: String) -> String { "\(service)\u{1f}\(account)" }

	public func seed(_ value: String, service: String, account: String, needsApproval: Bool = false) {
		lock.withLock {
			items[Self.key(service, account)] = Data(value.utf8)
			if needsApproval { locked.insert(Self.key(service, account)) }
		}
	}

	public func stored(service: String, account: String) -> Data? { lock.withLock { items[Self.key(service, account)] } }

	public func read(service: String, account: String) throws -> Data? { lock.withLock { items[Self.key(service, account)] } }

	public func readSilently(service: String, account: String) -> Data?? {
		lock.withLock {
			let key = Self.key(service, account)
			if locked.contains(key) { return nil }
			return .some(items[key])
		}
	}

	public func write(_ data: Data, service: String, account: String) throws {
		lock.withLock {
			items[Self.key(service, account)] = data
			locked.remove(Self.key(service, account))
		}
	}

	public func accounts(service: String) -> [String] {
		lock.withLock { items.keys.compactMap { key in
			let parts = key.split(separator: "\u{1f}", maxSplits: 1).map(String.init)
			return parts.count == 2 && parts[0] == service ? parts[1] : nil
		}.sorted() }
	}
}

/// Turns off Keychain dialogs for the duration of a read. Uses the legacy
/// `SecKeychainSetUserInteractionAllowed` (the only switch that suppresses the
/// "wants to use your confidential information" prompt), loaded dynamically.
enum KeychainInteraction {
	typealias Setter = @convention(c) (DarwinBoolean) -> OSStatus
	typealias Getter = @convention(c) (UnsafeMutablePointer<DarwinBoolean>) -> OSStatus

	static let functions: (set: Setter, get: Getter)? = {
		guard let handle = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_NOW),
		      let set = dlsym(handle, "SecKeychainSetUserInteractionAllowed"),
		      let get = dlsym(handle, "SecKeychainGetUserInteractionAllowed") else { return nil }
		return (unsafeBitCast(set, to: Setter.self), unsafeBitCast(get, to: Getter.self))
	}()

	static let lock = NSLock()

	static func withoutUI<T>(_ body: () -> T?) -> T? {
		guard let functions else { return nil } // can't guarantee no prompt: treat as unavailable
		return lock.withLock {
			var previous: DarwinBoolean = true
			_ = functions.get(&previous)
			_ = functions.set(false)
			defer { _ = functions.set(previous) }
			return body()
		}
	}
}

public struct KeychainError: Error, Sendable, LocalizedError {
	public let status: OSStatus
	public var errorDescription: String? {
		(SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)"
	}
}
