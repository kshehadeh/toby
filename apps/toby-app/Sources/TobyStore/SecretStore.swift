import Foundation
import Security

/// Named secrets (Mail, Slack, …) in the login Keychain. The OpenRouter key has
/// its own item (`TobyAI.KeychainKeyStore`).
public protocol SecretStore: Sendable {
	func secret(_ name: String) throws -> String?
	func setSecret(_ value: String, for name: String) throws
	func removeSecret(_ name: String) throws
}

public struct KeychainSecretStore: SecretStore {
	public let service: String

	public init(service: String = "app.toby.secrets") {
		self.service = service
	}

	public func secret(_ name: String) throws -> String? {
		var query = baseQuery(name)
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne
		var item: CFTypeRef?
		let status = SecItemCopyMatching(query as CFDictionary, &item)
		switch status {
		case errSecSuccess: return (item as? Data).flatMap { String(data: $0, encoding: .utf8) }
		case errSecItemNotFound: return nil
		default: throw SecretStoreError(status: status)
		}
	}

	public func setSecret(_ value: String, for name: String) throws {
		let data = Data(value.utf8)
		let status = SecItemUpdate(baseQuery(name) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
		if status == errSecItemNotFound {
			var add = baseQuery(name)
			add[kSecValueData as String] = data
			add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
			let added = SecItemAdd(add as CFDictionary, nil)
			guard added == errSecSuccess else { throw SecretStoreError(status: added) }
		} else if status != errSecSuccess {
			throw SecretStoreError(status: status)
		}
	}

	public func removeSecret(_ name: String) throws {
		let status = SecItemDelete(baseQuery(name) as CFDictionary)
		guard status == errSecSuccess || status == errSecItemNotFound else { throw SecretStoreError(status: status) }
	}

	private func baseQuery(_ name: String) -> [String: Any] {
		[
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: service,
			kSecAttrAccount as String: name,
		]
	}
}

/// In-memory secret store (tests, previews).
public final class InMemorySecretStore: SecretStore, @unchecked Sendable {
	private let lock = NSLock()
	private var values: [String: String]

	public init(_ values: [String: String] = [:]) {
		self.values = values
	}

	public var all: [String: String] { lock.withLock { values } }

	public func secret(_ name: String) throws -> String? { lock.withLock { values[name] } }
	public func setSecret(_ value: String, for name: String) throws { lock.withLock { values[name] = value } }
	public func removeSecret(_ name: String) throws { _ = lock.withLock { values.removeValue(forKey: name) } }
}

public struct SecretStoreError: Error, Sendable, LocalizedError {
	public let status: OSStatus
	public var errorDescription: String? {
		(SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)"
	}
}
