import CryptoKit
import Foundation
import Security
import TobyAI

/// Reads the daemon's `credentials.json`, which is either plaintext JSON or an
/// AES-256-GCM envelope (`toby.credentials.encrypted`, v1) whose 32-byte data
/// key is stored base64 in the Keychain (`dev.toby.credentials` /
/// `data-encryption-key`). Ported from `packages/core/src/config/credentials-crypto.ts`.
public enum LegacyCredentials {
	public static let envelopeFormat = "toby.credentials.encrypted"
	public static let defaultKeychainService = "dev.toby.credentials"
	public static let defaultKeychainAccount = "data-encryption-key"

	public enum Failure: Error, Sendable, Equatable {
		case missingDataKey
		case decryptionFailed
		case malformed
	}

	/// Supplies the envelope's data key (Keychain in the app; fixed in tests).
	public typealias DataKeyProvider = @Sendable (_ service: String, _ account: String) -> Data?

	/// Parse `credentials.json` contents into a JSON value (decrypting if needed).
	public static func decode(_ data: Data, dataKey: DataKeyProvider = keychainDataKey) throws -> JSONValue {
		guard let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { throw Failure.malformed }
		guard value["format"]?.stringValue == envelopeFormat else { return value }
		guard value["version"]?.intValue == 1,
		      let encryption = value["encryption"],
		      encryption["cipher"]?.stringValue == "aes-256-gcm",
		      let ivText = encryption["iv"]?.stringValue, let iv = Data(base64Encoded: ivText),
		      let tagText = encryption["authTag"]?.stringValue, let tag = Data(base64Encoded: tagText),
		      let cipherText = value["ciphertext"]?.stringValue, let ciphertext = Data(base64Encoded: cipherText)
		else { throw Failure.malformed }

		let service = encryption["keychainService"]?.stringValue ?? defaultKeychainService
		let account = encryption["keychainAccount"]?.stringValue ?? defaultKeychainAccount
		guard let key = dataKey(service, account), key.count == 32 else { throw Failure.missingDataKey }

		do {
			let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ciphertext, tag: tag)
			let plaintext = try AES.GCM.open(box, using: SymmetricKey(data: key))
			return try JSONDecoder().decode(JSONValue.self, from: plaintext)
		} catch {
			throw Failure.decryptionFailed
		}
	}

	/// Reads the base64 data key the TS daemon stored via `security add-generic-password -A`.
	public static let keychainDataKey: DataKeyProvider = { service, account in
		let query: [String: Any] = [
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: service,
			kSecAttrAccount as String: account,
			kSecReturnData as String: true,
			kSecMatchLimit as String: kSecMatchLimitOne,
		]
		var item: CFTypeRef?
		guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
		      let data = item as? Data,
		      let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
		else { return nil }
		return Data(base64Encoded: text)
	}

	/// Encrypt (tests / round-trip verification only).
	static func encryptForTesting(_ plaintext: Data, key: Data) throws -> JSONValue {
		let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: AES.GCM.Nonce())
		return [
			"version": 1,
			"format": .string(envelopeFormat),
			"encryption": [
				"cipher": "aes-256-gcm",
				"keySource": "keychain",
				"keychainService": .string(defaultKeychainService),
				"keychainAccount": .string(defaultKeychainAccount),
				"iv": .string(Data(box.nonce).base64EncodedString()),
				"authTag": .string(box.tag.base64EncodedString()),
			],
			"ciphertext": .string(box.ciphertext.base64EncodedString()),
		]
	}
}

/// Which legacy secrets carry over, and where they go.
///
/// Kept: OpenRouter (→ `KeychainKeyStore`), Mail (IMAP/SMTP), Slack, weather.
/// Dropped: other AI providers, MCP connections, Jira/Notion/News/Todoist,
/// cloud transcription keys.
public struct LegacySecretMapping: Sendable {
	public var openRouterKey: String?
	/// Secret name → value for `SecretStore` (e.g. `mail.imapPassword`).
	public var secrets: [String: String]

	public static func from(credentials: JSONValue) -> LegacySecretMapping {
		var secrets: [String: String] = [:]
		func copy(_ block: JSONValue?, prefix: String, fields: Set<String>? = nil) {
			for (field, value) in block?.objectValue ?? [:] {
				guard fields?.contains(field) ?? true, let text = value.stringValue, !text.isEmpty else { continue }
				secrets["\(prefix).\(field)"] = text
			}
		}
		// Integration bags (connections dual-written; integrations wins).
		copy(credentials["connections"]?["email"], prefix: "mail")
		copy(credentials["integrations"]?["email"], prefix: "mail")
		copy(credentials["connections"]?["slack"], prefix: "slack")
		copy(credentials["slack"], prefix: "slack")
		copy(credentials["integrations"]?["slack"], prefix: "slack")
		copy(credentials["weather"], prefix: "weather", fields: ["apiKey"])

		let openRouter = credentials["ai"]?["openrouter"]?["apiKey"]?.stringValue
		return LegacySecretMapping(
			openRouterKey: openRouter?.isEmpty == false ? openRouter : nil,
			secrets: secrets,
		)
	}
}
