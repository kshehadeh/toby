import Foundation

/// The OpenRouter API key, kept in Toby's Keychain vault (`TobyKeychain`).
public struct KeychainKeyStore: APIKeyProvider {
	static let key = "openrouter.apiKey"
	let vault: TobyKeychain

	public init(vault: TobyKeychain = .shared) {
		self.vault = vault
	}

	public func apiKey() async throws -> String? {
		try read()
	}

	public func read() throws -> String? {
		vault.value(Self.key)
	}

	public func save(_ key: String) throws {
		try vault.set(key, for: Self.key)
	}

	public func delete() throws {
		try vault.set(nil, for: Self.key)
	}
}
