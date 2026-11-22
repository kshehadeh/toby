import Foundation
import GRDB
import TobyAI

/// One-time, idempotent import of a daemon-era Toby home into the Swift store.
///
/// - Copies the legacy SQLite tables (column intersection, `INSERT OR IGNORE`),
///   reading from temporary *copies* so the legacy files are never opened for
///   writing.
/// - Converts AI-SDK chat messages into TobyAI `Message` JSON.
/// - Moves kept secrets (OpenRouter, Mail, Slack, weather) into the Keychain.
///
/// File-based data (`projects/`, `library/`, `listen/`, `skills/`, `persona/`)
/// stays in place; Swift reads the same directories.
public struct LegacyImporter: Sendable {
	/// Bump when the import procedure changes in a way that should re-run.
	public static let version = 1

	public struct Report: Sendable, Equatable {
		public var rowsByTable: [String: Int] = [:]
		public var messagesConverted = 0
		public var secretsImported: [String] = []
		public var importedOpenRouterKey = false
		public var warnings: [String] = []
		/// Rows skipped because their parent row no longer exists.
		public var orphansDropped: [String: Int] = [:]
		public var skipped = false
	}

	public let paths: TobyPaths
	public let database: TobyDatabase
	public let secrets: any SecretStore
	public let openRouterKeyStore: (@Sendable (String) throws -> Void)?
	public let credentialsDataKey: LegacyCredentials.DataKeyProvider

	public init(
		paths: TobyPaths,
		database: TobyDatabase,
		secrets: any SecretStore = KeychainSecretStore(),
		openRouterKeyStore: (@Sendable (String) throws -> Void)? = { try KeychainKeyStore().save($0) },
		credentialsDataKey: @escaping LegacyCredentials.DataKeyProvider = LegacyCredentials.keychainDataKey,
	) {
		self.paths = paths
		self.database = database
		self.secrets = secrets
		self.openRouterKeyStore = openRouterKeyStore
		self.credentialsDataKey = credentialsDataKey
	}

	/// Whether this home has already been imported at the current version.
	public func hasImported() throws -> Bool {
		try database.writer.read { db in
			let version = try Int.fetchOne(db, sql: "SELECT version FROM legacy_import_log WHERE step = 'complete'")
			return (version ?? 0) >= Self.version
		}
	}

	/// Run the import unless it already completed (pass `force` to re-run;
	/// existing rows are kept, missing ones are added).
	@discardableResult
	public func run(force: Bool = false) throws -> Report {
		var report = Report()
		if !force, try hasImported() {
			report.skipped = true
			return report
		}

		let scratch = FileManager.default.temporaryDirectory.appending(path: "toby-import-\(UUID().uuidString)", directoryHint: .isDirectory)
		try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: scratch) }

		let sources: [(file: URL, tables: [(from: String, to: String)])] = [
			(paths.legacyChatDatabase, Schema.chatTables.map { ($0, $0) }),
			(paths.legacyMemoryDatabase, Schema.memoryTables.map { ($0, $0) }),
			(paths.legacyTodoDeviceDatabase, Schema.todoDeviceTables.map { ($0.key, $0.value) }.sorted { $0.0 < $1.0 }),
		]

		for (file, tables) in sources {
			guard FileManager.default.fileExists(atPath: file.path), Self.fileSize(file) > 0 else { continue }
			let copy = scratch.appending(path: file.lastPathComponent)
			try FileManager.default.copyItem(at: file, to: copy)
			for sidecar in ["-wal", "-shm", "-journal"] {
				let side = URL(fileURLWithPath: file.path + sidecar)
				if FileManager.default.fileExists(atPath: side.path) {
					try? FileManager.default.copyItem(at: side, to: URL(fileURLWithPath: copy.path + sidecar))
				}
			}
			let copied = try copyTables(from: copy, tables: tables)
			report.rowsByTable.merge(copied.counts) { $0 + $1 }
			for (table, count) in copied.orphans.sorted(by: { $0.key < $1.key }) {
				report.orphansDropped[table, default: 0] += count
			}
		}

		report.messagesConverted = try convertMessages()
		try importSecrets(into: &report)

		try database.writer.write { db in
			for (table, rows) in report.rowsByTable {
				try db.execute(
					sql: "INSERT OR REPLACE INTO legacy_import_log (step, version, rows, detail, imported_at) VALUES (?, ?, ?, NULL, ?)",
					arguments: ["table:\(table)", Self.version, rows, Self.now()],
				)
			}
			try db.execute(
				sql: "INSERT OR REPLACE INTO legacy_import_log (step, version, rows, detail, imported_at) VALUES ('complete', ?, ?, ?, ?)",
				arguments: [Self.version, report.rowsByTable.values.reduce(0, +), report.warnings.joined(separator: "\n"), Self.now()],
			)
		}
		return report
	}

	// MARK: Tables

	/// Copy rows with `INSERT OR IGNORE` over the shared columns. Foreign keys are
	/// deferred so parent/child order doesn't matter.
	func copyTables(from legacyFile: URL, tables: [(from: String, to: String)]) throws -> (counts: [String: Int], orphans: [String: Int]) {
		var counts: [String: Int] = [:]
		var orphans: [String: Int] = [:]
		try database.writer.writeWithoutTransaction { db in
			try db.execute(sql: "ATTACH DATABASE ? AS legacy", arguments: [legacyFile.path])
			defer { try? db.execute(sql: "DETACH DATABASE legacy") }
			try db.inTransaction {
				try db.execute(sql: "PRAGMA defer_foreign_keys = ON")
				for (source, target) in tables {
					let legacyColumns = try Self.columns(db, schema: "legacy", table: source)
					guard !legacyColumns.isEmpty else { continue }
					let targetColumns = Set(try Self.columns(db, schema: "main", table: target))
					let shared = legacyColumns.filter(targetColumns.contains)
					guard !shared.isEmpty else { continue }
					let list = shared.map(\.quotedDatabaseIdentifier).joined(separator: ", ")
					try db.execute(sql: """
					INSERT OR IGNORE INTO main.\(target.quotedDatabaseIdentifier) (\(list))
					SELECT \(list) FROM legacy.\(source.quotedDatabaseIdentifier)
					""")
					counts[target, default: 0] += db.changesCount
				}
				// The daemon never enforced foreign keys, so legacy data can hold
				// orphans (e.g. runs of a deleted schedule). Drop them.
				for violation in try Row.fetchAll(db, sql: "PRAGMA main.foreign_key_check") {
					guard let table: String = violation["table"], let rowid: Int64 = violation["rowid"] else { continue }
					try db.execute(sql: "DELETE FROM main.\(table.quotedDatabaseIdentifier) WHERE rowid = ?", arguments: [rowid])
					counts[table, default: 0] -= 1
					orphans[table, default: 0] += 1
				}
				return .commit
			}
		}
		return (counts, orphans)
	}

	static func columns(_ db: Database, schema: String, table: String) throws -> [String] {
		let exists = try Bool.fetchOne(
			db,
			sql: "SELECT EXISTS(SELECT 1 FROM \(schema).sqlite_master WHERE type = 'table' AND name = ?)",
			arguments: [table],
		) ?? false
		guard exists else { return [] }
		return try Row.fetchAll(db, sql: "PRAGMA \(schema).table_info(\(table.quotedDatabaseIdentifier))")
			.compactMap { $0["name"] as String? }
	}

	// MARK: Messages

	/// Fill `message_json` (TobyAI `[Message]`) for rows that don't have it yet.
	func convertMessages() throws -> Int {
		try database.writer.write { db in
			let rows = try Row.fetchAll(
				db,
				sql: "SELECT session_id, idx, role, content_json FROM chat_session_messages WHERE message_json IS NULL",
			)
			let encoder = JSONEncoder()
			encoder.outputFormatting = [.sortedKeys]
			for row in rows {
				let messages = LegacyMessageConverter.convert(role: row["role"], contentJSON: row["content_json"])
				let json = String(decoding: try encoder.encode(messages), as: UTF8.self)
				try db.execute(
					sql: "UPDATE chat_session_messages SET message_json = ? WHERE session_id = ? AND idx = ?",
					arguments: [json, row["session_id"] as String, row["idx"] as Int],
				)
			}
			return rows.count
		}
	}

	// MARK: Secrets

	func importSecrets(into report: inout Report) throws {
		guard let data = try? Data(contentsOf: paths.legacyCredentials), !data.isEmpty else { return }
		let credentials: JSONValue
		do {
			credentials = try LegacyCredentials.decode(data, dataKey: credentialsDataKey)
		} catch {
			report.warnings.append("Couldn’t read saved credentials (\(error)). Sign in with OpenRouter again and re-enter Mail/Slack passwords.")
			return
		}
		let mapping = LegacySecretMapping.from(credentials: credentials)
		for name in mapping.secrets.keys.sorted() {
			guard let value = mapping.secrets[name] else { continue }
			// Never overwrite a secret the native app already has.
			if let existing = try? secrets.secret(name), !existing.isEmpty { continue }
			try secrets.setSecret(value, for: name)
			report.secretsImported.append(name)
		}
		if let key = mapping.openRouterKey, let store = openRouterKeyStore {
			try store(key)
			report.importedOpenRouterKey = true
		}
	}

	// MARK: Helpers

	static func fileSize(_ url: URL) -> Int {
		((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.intValue ?? 0
	}

	static func now() -> String {
		ISO8601DateFormatter().string(from: Date())
	}
}
