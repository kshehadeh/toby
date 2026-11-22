import Foundation
import Security

/// Stores the OpenRouter API key as a generic password in the login Keychain.
public struct KeychainKeyStore: APIKeyProvider {
	public let service: String
	public let account: String

	public init(service: String = "app.toby.openrouter", account: String = "api-key") {
		self.service = service
		self.account = account
	}

	public func apiKey() async throws -> String? {
		try read()
	}

	public func read() throws -> String? {
		var query = baseQuery
		query[kSecReturnData as String] = true
		query[kSecMatchLimit as String] = kSecMatchLimitOne
		var item: CFTypeRef?
		let status = SecItemCopyMatching(query as CFDictionary, &item)
		switch status {
		case errSecSuccess:
			guard let data = item as? Data else { return nil }
			return String(data: data, encoding: .utf8)
		case errSecItemNotFound:
			return nil
		default:
			throw KeychainError(status: status)
		}
	}

	public func save(_ key: String) throws {
		let data = Data(key.utf8)
		let update: [String: Any] = [kSecValueData as String: data]
		let status = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
		if status == errSecItemNotFound {
			var add = baseQuery
			add[kSecValueData as String] = data
			add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
			let addStatus = SecItemAdd(add as CFDictionary, nil)
			guard addStatus == errSecSuccess else { throw KeychainError(status: addStatus) }
		} else if status != errSecSuccess {
			throw KeychainError(status: status)
		}
	}

	public func delete() throws {
		let status = SecItemDelete(baseQuery as CFDictionary)
		guard status == errSecSuccess || status == errSecItemNotFound else {
			throw KeychainError(status: status)
		}
	}

	private var baseQuery: [String: Any] {
		[
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: service,
			kSecAttrAccount as String: account,
		]
	}
}

public struct KeychainError: Error, Sendable, LocalizedError {
	public let status: OSStatus
	public var errorDescription: String? {
		(SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)"
	}
}
