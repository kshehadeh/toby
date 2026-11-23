import Foundation
import Security
import TobyAI

/// Named secrets (Mail, Slack, …).
public protocol SecretStore: Sendable {
	func secret(_ name: String) throws -> String?
	func setSecret(_ value: String, for name: String) throws
	func removeSecret(_ name: String) throws
}

/// Named secrets in Toby's single Keychain vault (`TobyKeychain`).
public struct KeychainSecretStore: SecretStore {
	let vault: TobyKeychain

	public init(vault: TobyKeychain = .shared) {
		self.vault = vault
	}

	public func secret(_ name: String) throws -> String? { vault.value(name) }
	public func setSecret(_ value: String, for name: String) throws { try vault.set(value, for: name) }
	public func removeSecret(_ name: String) throws { try vault.set(nil, for: name) }
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
