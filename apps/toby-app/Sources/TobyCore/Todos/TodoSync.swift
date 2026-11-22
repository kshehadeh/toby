import Foundation
import GRDB
import Security
import TobyAI

// MARK: Batch format

/// Encrypted, immutable batches of todo operations exchanged through the sync
/// folder (port of `todos/sync-crypto.ts`). Format-compatible with the daemon.
enum TodoBatchCodec {
	static let format = "toby.todos.operations.encrypted"
	static let maxBatchBytes = 2 * 1024 * 1024
	static let maxOperations = 2048

	static func encrypt(_ operations: [TodoOperation], password: String) throws -> String {
		guard (1 ... maxOperations).contains(operations.count) else { throw TodoError.invalid("Invalid todo batch size.") }
		let payload: JSONValue = [
			"version": 1,
			"format": "toby.todos.operations",
			"operations": .array(operations.map(\.json)),
		]
		let plaintext = Data(payload.jsonString().utf8)
		guard plaintext.count <= maxBatchBytes / 2 else { throw TodoError.invalid("Todo batch is too large.") }
		let sealed = try PasswordEncryption.encrypt(plaintext, password: password)
		let envelope: JSONValue = [
			"version": 1,
			"format": .string(format),
			"encryption": sealed.encryption,
			"ciphertext": .string(sealed.ciphertext),
		]
		return envelope.jsonString()
	}

	static func decrypt(_ raw: String, password: String) throws -> [TodoOperation] {
		guard raw.utf8.count <= maxBatchBytes else { throw TodoError.invalid("Todo batch is too large.") }
		let envelope = try JSONValue(parsing: raw)
		// Fixed KDF parameters are checked before running scrypt on remote data.
		guard envelope["version"] == 1, envelope["format"]?.stringValue == format,
		      let encryption = envelope["encryption"],
		      encryption["cipher"] == "aes-256-gcm", encryption["kdf"] == "scrypt",
		      encryption["n"] == 16384, encryption["r"] == 8, encryption["p"] == 1, encryption["keyLength"] == 32,
		      Data(base64Encoded: encryption["salt"]?.stringValue ?? "")?.count == 16,
		      Data(base64Encoded: encryption["iv"]?.stringValue ?? "")?.count == 12,
		      Data(base64Encoded: encryption["authTag"]?.stringValue ?? "")?.count == 16,
		      let ciphertext = envelope["ciphertext"]?.stringValue, !ciphertext.isEmpty
		else { throw TodoError.invalid("Invalid todo batch envelope.") }
		let plaintext = try PasswordEncryption.decrypt(encryption: encryption, ciphertext: ciphertext, password: password)
		let payload = try JSONDecoder().decode(JSONValue.self, from: plaintext)
		guard payload["version"] == 1, payload["format"] == "toby.todos.operations",
		      let operations = payload["operations"]?.arrayValue, (1 ... maxOperations).contains(operations.count)
		else { throw TodoError.invalid("Invalid todo batch payload.") }
		return try operations.map(TodoOperation.parse)
	}
}

// MARK: Batch stores

/// Where batches live: `<root>/todos/v1/<replica>/<uuid>.json`.
public protocol TodoBatchStore: Sendable {
	/// Identity of the destination (its vault root path).
	var rootDirectory: String { get }
	func list() async throws -> [String]
	func read(_ name: String) async throws -> String
	func write(_ name: String, contents: String) async throws
}

enum TodoBatchName {
	static func validate(_ name: String) throws {
		guard name.wholeMatch(of: /[a-zA-Z0-9_-]{1,200}\/[a-zA-Z0-9_-]{1,200}\.json/) != nil else {
			throw TodoError.invalid("Invalid todo batch filename.")
		}
	}
}

/// Plain-filesystem batch store (folder backend, `TOBY_SYNC_DIR`).
public struct FileTodoBatchStore: TodoBatchStore {
	public let rootDirectory: String
	var batchRoot: URL { URL(fileURLWithPath: rootDirectory).appending(path: "todos/v1", directoryHint: .isDirectory) }

	public init(rootDirectory: String) {
		self.rootDirectory = rootDirectory
	}

	func rejectSymlinks(_ target: URL) throws {
		let root = URL(fileURLWithPath: rootDirectory)
		var current = root
		for component in target.path.dropFirst(root.path.count).split(separator: "/") {
			current = current.appending(path: String(component))
			if let attributes = try? FileManager.default.attributesOfItem(atPath: current.path),
			   attributes[.type] as? FileAttributeType == .typeSymbolicLink
			{
				throw TodoError.invalid("Todo sync paths must not contain symbolic links.")
			}
		}
	}

	public func list() async throws -> [String] {
		try rejectSymlinks(batchRoot)
		let fm = FileManager.default
		guard let replicas = try? fm.contentsOfDirectory(atPath: batchRoot.path) else { return [] }
		var names: [String] = []
		for replica in replicas where replica.wholeMatch(of: /[a-zA-Z0-9_-]{1,200}/) != nil {
			let folder = batchRoot.appending(path: replica, directoryHint: .isDirectory)
			try rejectSymlinks(folder)
			var isDirectory: ObjCBool = false
			guard fm.fileExists(atPath: folder.path, isDirectory: &isDirectory), isDirectory.boolValue else { continue }
			for file in (try? fm.contentsOfDirectory(atPath: folder.path)) ?? [] where file.wholeMatch(of: /[a-zA-Z0-9_-]{1,200}\.json/) != nil {
				names.append("\(replica)/\(file)")
			}
		}
		return names.sorted()
	}

	public func read(_ name: String) async throws -> String {
		try TodoBatchName.validate(name)
		let file = batchRoot.appending(path: name)
		try rejectSymlinks(file)
		let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue ?? 0
		guard size <= TodoBatchCodec.maxBatchBytes else { throw TodoError.invalid("Todo batch is too large.") }
		return try String(contentsOf: file, encoding: .utf8)
	}

	public func write(_ name: String, contents: String) async throws {
		try TodoBatchName.validate(name)
		guard contents.utf8.count <= TodoBatchCodec.maxBatchBytes else { throw TodoError.invalid("Todo batch is too large.") }
		let file = batchRoot.appending(path: name)
		try rejectSymlinks(file)
		let folder = file.deletingLastPathComponent()
		try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
		let temporary = folder.appending(path: ".\(UUID().uuidString).tmp")
		defer { try? FileManager.default.removeItem(at: temporary) }
		guard FileManager.default.createFile(atPath: temporary.path, contents: Data(contents.utf8), attributes: [.posixPermissions: 0o600]) else {
			throw TodoError("sync_failed", "Could not write the todo batch.")
		}
		// link(2) is atomic and refuses to overwrite an existing immutable batch.
		guard link(temporary.path, file.path) == 0 else {
			throw TodoError("sync_failed", "Could not publish the todo batch (\(String(cString: strerror(errno)))).")
		}
	}
}

// MARK: Sync settings (shared with Sync & Backup)

/// The bits of `sync-state.json` and the sync passphrase that todo sync needs.
public struct TodoSyncSettings: Sendable, Equatable {
	public var enabled: Bool
	public var backend: String
	public var folderPath: String?
	public var deviceID: String

	public static func read(tobyDirectory: URL) -> TodoSyncSettings {
		let file = tobyDirectory.appending(path: "sync-state.json")
		let state = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
		let backend = state?["backend"]?.stringValue
		return TodoSyncSettings(
			enabled: state?["enabled"] == true,
			backend: backend == "folder" ? "folder" : "icloud",
			folderPath: state?["folderPath"]?.stringValue,
			deviceID: state?["deviceId"]?.stringValue ?? "",
		)
	}

	/// The vault root as the daemon spells it (`path.resolve` + `Toby/sync`).
	/// Destination identity is a hash of this string, so it must match exactly.
	public func vaultRoot(environment: [String: String] = ProcessInfo.processInfo.environment, iCloudRoot: String? = nil) -> String {
		if let override = environment["TOBY_SYNC_DIR"]?.trimmingCharacters(in: .whitespacesAndNewlines), !override.isEmpty {
			return Self.resolve(override)
		}
		if backend == "folder" {
			let picked = folderPath?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			return Self.resolve((picked.isEmpty ? "/nonexistent-toby-sync-folder" : picked) + "/Toby/sync")
		}
		return iCloudRoot ?? Self.resolve(FileManager.default.homeDirectoryForCurrentUser.path + "/Library/Mobile Documents/com~apple~CloudDocs/Toby/sync")
	}

	/// Node `path.resolve`: absolute, normalized, no trailing slash.
	public static func resolve(_ path: String) -> String {
		let absolute = path.hasPrefix("/") ? path : FileManager.default.currentDirectoryPath + "/" + path
		var parts: [Substring] = []
		for component in absolute.split(separator: "/") {
			switch component {
			case ".": continue
			case "..": if !parts.isEmpty { parts.removeLast() }
			default: parts.append(component)
			}
		}
		let resolved = "/" + parts.joined(separator: "/")
		// Legacy layout `Toby/config-sync` was renamed to `Toby/sync`.
		return resolved.hasSuffix("/config-sync") ? String(resolved.dropLast("config-sync".count)) + "sync" : resolved
	}

	/// The vault passphrase the daemon stored in the Keychain (`dev.toby.sync`),
	/// falling back to `<tobyDir>/sync-passphrase`.
	public static func passphrase(tobyDirectory: URL) -> String? {
		let query: [String: Any] = [
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: "dev.toby.sync",
			kSecAttrAccount as String: "vault-passphrase",
			kSecReturnData as String: true,
			kSecMatchLimit as String: kSecMatchLimitOne,
		]
		var item: CFTypeRef?
		if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data,
		   let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty
		{
			return text
		}
		let file = tobyDirectory.appending(path: "sync-passphrase")
		return (try? String(contentsOf: file, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
	}
}

extension String {
	var nilIfEmpty: String? { isEmpty ? nil : self }
}

// MARK: Exchange

/// Pull-then-push todo sync (port of `todos/sync.ts`).
public final class TodoSync: Sendable {
	public struct ExchangeResult: Sendable, Equatable {
		public var pulled = 0
		public var published = 0
		public var uploadedBytes = 0
		public var downloadedBytes = 0

		public var json: JSONValue {
			[
				"pulled": .number(Double(pulled)), "published": .number(Double(published)),
				"uploadedBytes": .number(Double(uploadedBytes)), "downloadedBytes": .number(Double(downloadedBytes)),
			]
		}
	}

	public let service: TodoService
	var store: TodoStore { service.store }

	public init(service: TodoService) {
		self.service = service
	}

	func state(_ db: Database, _ key: String) throws -> String? {
		try String.fetchOne(db, sql: "SELECT value FROM todo_device_state WHERE key = ?", arguments: [key])
	}

	func setState(_ key: String, _ value: String) throws {
		try store.writer.write { db in
			try db.execute(sql: "INSERT OR REPLACE INTO todo_device_state(key, value) VALUES (?, ?)", arguments: [key, value])
		}
	}

	public func status() throws -> JSONValue {
		try store.writer.read { db in
			let destination = try self.state(db, "destination") ?? ""
			let pending = try Int.fetchOne(db, sql: """
			SELECT COUNT(*) FROM todo_operations o WHERE NOT EXISTS (
			  SELECT 1 FROM todo_device_published p WHERE p.destination = ? AND p.operation_id = o.id)
			""", arguments: [destination]) ?? 0
			return [
				"pausedForRestore": .bool(self.service.needsRestoreReview),
				"lastSuccess": (try self.state(db, "lastSuccess")?.nilIfEmpty).map(JSONValue.string) ?? .null,
				"error": (try self.state(db, "error")?.nilIfEmpty).map(JSONValue.string) ?? .null,
				"pending": .number(Double(pending)),
			]
		}
	}

	/// Destination identity: hash of the vault root (matches the daemon).
	public static func destination(for store: any TodoBatchStore) -> String {
		TodoHash.hex(.string(store.rootDirectory))
	}

	/// Pull all unseen batches (each commits atomically), then publish local
	/// operations not yet at this destination.
	public func exchange(store batches: any TodoBatchStore, password: String, isCurrent: @Sendable () -> Bool = { true }) async throws -> ExchangeResult {
		func check() throws {
			guard isCurrent(), !service.needsRestoreReview else {
				throw TodoError("sync_context_changed", "Todo sync context changed. Retry after reviewing sync settings.")
			}
		}
		try check()
		let destination = Self.destination(for: batches)
		try await store.writer.write { db in
			try db.execute(sql: "INSERT OR REPLACE INTO todo_device_state(key, value) VALUES (?, ?)", arguments: ["destination", destination])
		}
		var result = ExchangeResult()
		var appliedAny = false

		for name in try await batches.list() {
			let seen = try await store.writer.read { db in
				try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM todo_device_files WHERE destination = ? AND name = ?)", arguments: [destination, name]) ?? false
			}
			if seen { continue }
			let contents = try await batches.read(name)
			try check()
			let operations = try TodoBatchCodec.decrypt(contents, password: password)
			try check()
			let pulled = try await store.writer.write { db -> Int in
				var count = 0
				for operation in operations {
					if try self.store.apply(db, operation) { count += 1 }
					try db.execute(sql: "INSERT OR IGNORE INTO todo_device_published(destination, operation_id) VALUES (?, ?)", arguments: [destination, operation.id])
				}
				try db.execute(sql: "INSERT INTO todo_device_files(destination, name) VALUES (?, ?)", arguments: [destination, name])
				return count
			}
			result.pulled += pulled
			appliedAny = appliedAny || pulled > 0
			result.downloadedBytes += contents.utf8.count
		}

		while true {
			try check()
			let rows = try await store.writer.read { db in
				try String.fetchAll(db, sql: """
				SELECT data FROM todo_operations o WHERE NOT EXISTS (
				  SELECT 1 FROM todo_device_published p WHERE p.destination = ? AND p.operation_id = o.id)
				ORDER BY clock, replica, id LIMIT ?
				""", arguments: [destination, TodoBatchCodec.maxOperations])
			}
			if rows.isEmpty { break }
			var batch: [TodoOperation] = []
			var bytes = 0
			for row in rows {
				if bytes + row.utf8.count > 900_000, !batch.isEmpty { break }
				batch.append(try TodoOperation.parse(JSONValue(parsing: row)))
				bytes += row.utf8.count
			}
			let contents = try TodoBatchCodec.encrypt(batch, password: password)
			try check()
			let name = "\(try service.replica())/\(UUID().uuidString.lowercased()).json"
			try await batches.write(name, contents: contents)
			try check()
			let published = batch
			try await store.writer.write { db in
				for operation in published {
					try db.execute(sql: "INSERT OR IGNORE INTO todo_device_published(destination, operation_id) VALUES (?, ?)", arguments: [destination, operation.id])
				}
				try db.execute(sql: "INSERT OR IGNORE INTO todo_device_files(destination, name) VALUES (?, ?)", arguments: [destination, name])
			}
			result.published += batch.count
			result.uploadedBytes += contents.utf8.count
		}
		if appliedAny { store.notifyChanged() }
		return result
	}

	/// After a restore was reviewed: forget what this device has seen/published.
	public func reconcileRestored() throws {
		guard service.needsRestoreReview else { return }
		try store.writer.write { db in
			try db.execute(sql: "DELETE FROM todo_device_files; DELETE FROM todo_device_published; DELETE FROM todo_device_state;")
		}
		try? FileManager.default.removeItem(at: service.restoreMarker)
	}

	/// Record the outcome of a tick (status line in Settings).
	public func record(success: Bool, error: String?) {
		if success {
			try? setState("lastSuccess", TodoRecurrence.isoString(Date()))
			try? setState("error", "")
		} else {
			try? setState("error", error ?? "Todo sync failed.")
		}
	}
}
