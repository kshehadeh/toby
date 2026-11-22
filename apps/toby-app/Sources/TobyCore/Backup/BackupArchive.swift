import CryptoKit
import Foundation
import TobyAI

/// The daemon's encrypted backup container (`TOBYBACKUP\t1\t<offset>\n`,
/// AES-256-GCM sections, plaintext JSON header at the tail). CryptoKit GCM
/// is one-shot, so each section is sealed/opened in memory.
public enum BackupArchive {
	static let magic = "TOBYBACKUP"
	static let prefixLength = "TOBYBACKUP\t1\t0000000000000000\n".utf8.count

	public struct Failure: Error, LocalizedError, Sendable, Equatable {
		public var message: String
		public init(_ message: String) { self.message = message }
		public var errorDescription: String? { message }
	}

	static let decryptFailure = Failure("Could not decrypt backup. Check that the password is correct and the file is valid.")

	static func prefix(_ offset: Int) -> Data { Data("\(magic)\t1\t\(String(format: "%016d", offset))\n".utf8) }

	public static func isArchive(_ url: URL) -> Bool {
		guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
		defer { try? handle.close() }
		return (try? handle.read(upToCount: magic.count + 1)) == Data("\(magic)\t".utf8)
	}

	static func key(_ password: String, salt: Data, n: Int, r: Int, p: Int, length: Int) throws -> SymmetricKey {
		SymmetricKey(data: try Scrypt.derive(password: Data(password.utf8), salt: salt, n: n, r: r, p: p, keyLength: length))
	}

	/// Streams sealed sections to `<url>.tmp`; `finish` appends the header,
	/// patches the prefix offset, and renames into place.
	public final class Writer {
		let key: SymmetricKey
		let salt: Data
		let url: URL
		let tmp: URL
		let handle: FileHandle
		var length = 0
		var sections: [String: JSONValue] = [:]

		public init(password: String, url: URL) throws {
			let trimmed = password.trimmingCharacters(in: .whitespacesAndNewlines)
			guard !trimmed.isEmpty else { throw Failure("Backup password cannot be empty.") }
			var bytes = [UInt8](repeating: 0, count: 16)
			_ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
			salt = Data(bytes)
			key = try BackupArchive.key(trimmed, salt: salt, n: PasswordEncryption.n, r: PasswordEncryption.r, p: PasswordEncryption.p, length: PasswordEncryption.keyLength)
			self.url = url
			tmp = URL(fileURLWithPath: url.path + ".\(UUID().uuidString.prefix(8)).tmp")
			try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
			FileManager.default.createFile(atPath: tmp.path, contents: BackupArchive.prefix(0), attributes: [.posixPermissions: 0o600])
			handle = try FileHandle(forWritingTo: tmp)
			try handle.seekToEnd()
		}

		deinit { try? handle.close() }

		public func section(_ name: String, _ data: Data) throws {
			guard sections[name] == nil else { throw Failure("Duplicate archive section: \(name)") }
			let sealed = try AES.GCM.seal(data, using: key)
			sections[name] = [
				"offset": .number(Double(length)), "length": .number(Double(sealed.ciphertext.count)),
				"iv": .string(Data(sealed.nonce).base64EncodedString()), "authTag": .string(sealed.tag.base64EncodedString()),
			]
			try handle.write(contentsOf: sealed.ciphertext)
			length += sealed.ciphertext.count
		}

		public func finish(info: [String: String] = [:]) throws {
			var header: [String: JSONValue] = [
				"format": "toby.backup.archive", "version": 1, "createdAt": .string(TodoRecurrence.isoString(Date())),
				"kdf": ["kdf": "scrypt", "n": .number(Double(PasswordEncryption.n)), "r": .number(Double(PasswordEncryption.r)), "p": .number(Double(PasswordEncryption.p)),
				        "keyLength": .number(Double(PasswordEncryption.keyLength)), "salt": .string(salt.base64EncodedString())],
				"sections": .object(sections),
			]
			if !info.isEmpty { header["info"] = .object(info.mapValues(JSONValue.string)) }
			try handle.write(contentsOf: Data((JSONValue.object(header).jsonString() + "\n").utf8))
			try handle.seek(toOffset: 0)
			try handle.write(contentsOf: BackupArchive.prefix(BackupArchive.prefixLength + length))
			try handle.close()
			if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
			try FileManager.default.moveItem(at: tmp, to: url)
		}

		public func discard() {
			try? handle.close()
			try? FileManager.default.removeItem(at: tmp)
		}
	}

	/// Reads sections from a memory-mapped archive.
	public struct Reader {
		public let header: JSONValue
		let data: Data
		let key: SymmetricKey

		public static func header(_ url: URL) throws -> (header: JSONValue, data: Data) {
			let data = try Data(contentsOf: url, options: .alwaysMapped)
			guard data.count > prefixLength else { throw Failure("Not a valid Toby backup archive.") }
			let parts = String(decoding: data.prefix(prefixLength), as: UTF8.self).split(separator: "\t")
			guard parts.count == 3, parts[0] == magic, parts[1] == "1",
			      let offset = Int(parts[2].trimmingCharacters(in: .whitespacesAndNewlines)), offset > prefixLength, offset < data.count else {
				throw Failure("Not a valid Toby backup archive.")
			}
			guard let header = try? JSONDecoder().decode(JSONValue.self, from: data.subdata(in: offset ..< data.count)),
			      header["format"] == "toby.backup.archive", header["kdf"]?["kdf"] == "scrypt" else { throw Failure("Backup archive header is invalid.") }
			return (header, data)
		}

		public init(_ url: URL, password: String) throws {
			let trimmed = password.trimmingCharacters(in: .whitespacesAndNewlines)
			guard !trimmed.isEmpty else { throw Failure("This backup is encrypted. Enter the backup password.") }
			(header, data) = try Self.header(url)
			let kdf = header["kdf"]!
			guard let salt = kdf["salt"]?.stringValue.flatMap({ Data(base64Encoded: $0) }) else { throw Failure("Backup archive header is invalid.") }
			key = try BackupArchive.key(trimmed, salt: salt, n: kdf["n"]?.intValue ?? 16384, r: kdf["r"]?.intValue ?? 8, p: kdf["p"]?.intValue ?? 1, length: kdf["keyLength"]?.intValue ?? 32)
		}

		public func has(_ name: String) -> Bool { header["sections"]?[name] != nil }

		public func section(_ name: String) throws -> Data {
			guard let info = header["sections"]?[name], let offset = info["offset"]?.intValue, let length = info["length"]?.intValue,
			      let iv = info["iv"]?.stringValue.flatMap({ Data(base64Encoded: $0) }), let tag = info["authTag"]?.stringValue.flatMap({ Data(base64Encoded: $0) }) else {
				throw Failure("Backup archive has no \"\(name)\" section.")
			}
			let start = prefixLength + offset
			guard start >= prefixLength, start + length <= data.count else { throw decryptFailure }
			do {
				let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: data.subdata(in: start ..< start + length), tag: tag)
				return try AES.GCM.open(box, using: key)
			} catch {
				throw decryptFailure
			}
		}
	}

	/// Gunzip (legacy database snapshots are gzip + base64).
	static func gunzip(_ data: Data) throws -> Data {
		let bytes = [UInt8](data)
		guard bytes.count > 18, bytes[0] == 0x1F, bytes[1] == 0x8B, bytes[2] == 8 else { throw Failure("Database snapshot is not gzip data.") }
		let flags = bytes[3]
		var index = 10
		if flags & 0x04 != 0 { index += 2 + Int(bytes[index]) + Int(bytes[index + 1]) << 8 }
		if flags & 0x08 != 0 { while index < bytes.count, bytes[index] != 0 { index += 1 }; index += 1 }
		if flags & 0x10 != 0 { while index < bytes.count, bytes[index] != 0 { index += 1 }; index += 1 }
		if flags & 0x02 != 0 { index += 2 }
		guard index < bytes.count - 8 else { throw Failure("Database snapshot is truncated.") }
		return try (Data(bytes[index ..< bytes.count - 8]) as NSData).decompressed(using: .zlib) as Data
	}
}

/// Read/write access to the OpenRouter key (Keychain in the app).
public protocol APIKeyStore: Sendable {
	func read() throws -> String?
	func save(_ key: String) throws
}

extension KeychainKeyStore: APIKeyStore {}
