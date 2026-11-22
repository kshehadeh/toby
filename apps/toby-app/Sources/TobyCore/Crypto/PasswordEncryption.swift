import CryptoKit
import Foundation
import TobyAI

/// Password-based AES-256-GCM with scrypt (N=16384, r=8, p=1), compatible with
/// the daemon's `config/backup-crypto.ts` envelopes.
public enum PasswordEncryption {
	public static let n = 16384
	public static let r = 8
	public static let p = 1
	public static let keyLength = 32

	public struct Failure: Error, Sendable, LocalizedError {
		public let message: String
		public var errorDescription: String? { message }
	}

	/// Encrypt; returns the `encryption` block and base64 ciphertext.
	public static func encrypt(_ plaintext: Data, password: String) throws -> (encryption: JSONValue, ciphertext: String) {
		var salt = [UInt8](repeating: 0, count: 16)
		_ = SecRandomCopyBytes(kSecRandomDefault, salt.count, &salt)
		let key = try Scrypt.derive(password: Data(password.utf8), salt: Data(salt), n: n, r: r, p: p, keyLength: keyLength)
		let box = try AES.GCM.seal(plaintext, using: SymmetricKey(data: key), nonce: AES.GCM.Nonce())
		let encryption: JSONValue = [
			"cipher": "aes-256-gcm",
			"kdf": "scrypt",
			"n": .number(Double(n)),
			"r": .number(Double(r)),
			"p": .number(Double(p)),
			"keyLength": .number(Double(keyLength)),
			"salt": .string(Data(salt).base64EncodedString()),
			"iv": .string(Data(box.nonce).base64EncodedString()),
			"authTag": .string(box.tag.base64EncodedString()),
		]
		return (encryption, box.ciphertext.base64EncodedString())
	}

	/// Decrypt an `encryption` block + base64 ciphertext.
	public static func decrypt(encryption: JSONValue, ciphertext: String, password: String) throws -> Data {
		let failure = Failure(message: "Could not decrypt backup. Check that the password is correct and the file is valid.")
		guard let salt = encryption["salt"]?.stringValue.flatMap({ Data(base64Encoded: $0) }),
		      let iv = encryption["iv"]?.stringValue.flatMap({ Data(base64Encoded: $0) }),
		      let tag = encryption["authTag"]?.stringValue.flatMap({ Data(base64Encoded: $0) }),
		      let body = Data(base64Encoded: ciphertext),
		      let n = encryption["n"]?.intValue, let r = encryption["r"]?.intValue,
		      let p = encryption["p"]?.intValue, let length = encryption["keyLength"]?.intValue
		else { throw failure }
		do {
			let key = try Scrypt.derive(password: Data(password.utf8), salt: salt, n: n, r: r, p: p, keyLength: length)
			let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: body, tag: tag)
			return try AES.GCM.open(box, using: SymmetricKey(data: key))
		} catch {
			throw failure
		}
	}
}
