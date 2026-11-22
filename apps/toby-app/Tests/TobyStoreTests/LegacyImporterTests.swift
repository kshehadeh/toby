import Foundation
import GRDB
import Testing
import TobyAI
@testable import TobyStore

/// Builds a fake daemon-era Toby home in a temp directory.
struct LegacyHomeFixture {
	let paths: TobyPaths

	init() throws {
		let root = FileManager.default.temporaryDirectory.appending(path: "toby-fixture-\(UUID().uuidString)", directoryHint: .isDirectory)
		try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
		paths = TobyPaths(root: root)
	}

	func makeChatDatabase() throws {
		let db = try DatabaseQueue(path: paths.legacyChatDatabase.path)
		try db.write { db in
			// Legacy shape, including a column the Swift schema doesn't have.
			try db.execute(sql: """
			CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
			  last_pretreatment_json TEXT, settings_json TEXT, context_window_json TEXT, project_id TEXT, retired_column TEXT);
			CREATE TABLE chat_session_messages (session_id TEXT NOT NULL, idx INTEGER NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL,
			  PRIMARY KEY (session_id, idx));
			CREATE TABLE chat_session_transcript (session_id TEXT NOT NULL, idx INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
			  PRIMARY KEY (session_id, idx));
			CREATE TABLE todo_entities (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
			CREATE TABLE user_tools (id TEXT PRIMARY KEY, name TEXT NOT NULL);
			INSERT INTO chat_sessions VALUES ('s1', 'Planning', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z', NULL, NULL, NULL, NULL, 'x');
			INSERT INTO chat_session_messages VALUES ('s1', 0, 'user', '"What is due today?"');
			INSERT INTO chat_session_messages VALUES ('s1', 1, 'assistant', '[{"type":"tool-call","toolCallId":"c1","toolName":"listTobyTodos","input":{}}]');
			INSERT INTO chat_session_messages VALUES ('s1', 2, 'tool', '[{"type":"tool-result","toolCallId":"c1","toolName":"listTobyTodos","output":{"type":"json","value":[]}}]');
			INSERT INTO chat_session_messages VALUES ('s1', 3, 'assistant', '[{"type":"text","text":"Nothing is due."}]');
			INSERT INTO chat_session_transcript VALUES ('s1', 0, 'user', 'What is due today?');
			INSERT INTO todo_entities VALUES ('todo', 't1', '{"title":"Pay rent"}');
			INSERT INTO user_tools VALUES ('u1', 'removed feature');
			CREATE TABLE chat_plans (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
			  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			INSERT INTO chat_plans VALUES ('p1', 's1', 'kept', 'pending', 'now', 'now');
			INSERT INTO chat_plans VALUES ('p2', 'deleted-session', 'orphan', 'pending', 'now', 'now');
			""")
		}
	}

	func makeMemoryDatabase() throws {
		let db = try DatabaseQueue(path: paths.legacyMemoryDatabase.path)
		try db.write { db in
			try db.execute(sql: """
			CREATE TABLE memory_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, subject TEXT, value TEXT NOT NULL,
			  confidence REAL NOT NULL DEFAULT 0.5, sensitivity TEXT NOT NULL DEFAULT 'normal', visibility TEXT NOT NULL DEFAULT 'usable_by_ai',
			  expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE TABLE memory_embeddings (memory_id TEXT PRIMARY KEY, embedding_blob BLOB NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL);
			INSERT INTO memory_items (id, user_id, type, value, created_at, updated_at) VALUES ('m1', 'me', 'preference', 'Prefers mornings', 'now', 'now');
			""")
			try db.execute(
				sql: "INSERT INTO memory_embeddings VALUES ('m1', ?, 'openai/text-embedding-3-small', 'now')",
				arguments: [VectorMath.blob([0.25, 0.5])],
			)
		}
	}

	func makeTodoDeviceDatabase() throws {
		let db = try DatabaseQueue(path: paths.legacyTodoDeviceDatabase.path)
		try db.write { db in
			try db.execute(sql: """
			CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			INSERT INTO state VALUES ('replica', 'device-123');
			""")
		}
	}

	func writeCredentials(_ json: String) throws {
		try Data(json.utf8).write(to: paths.legacyCredentials)
	}

	func cleanup() {
		try? FileManager.default.removeItem(at: paths.root)
	}
}

final class SavedKey: @unchecked Sendable {
	private let lock = NSLock()
	private var stored: String?
	var value: String? { lock.withLock { stored } }
	func save(_ key: String) { lock.withLock { stored = key } }
}

@Suite("Legacy importer")
struct LegacyImporterTests {
	@Test func importsTablesMessagesAndSecrets() throws {
		let fixture = try LegacyHomeFixture()
		defer { fixture.cleanup() }
		try fixture.makeChatDatabase()
		try fixture.makeMemoryDatabase()
		try fixture.makeTodoDeviceDatabase()
		try fixture.writeCredentials(#"{"ai":{"openrouter":{"apiKey":"sk-or-legacy"}},"integrations":{"email":{"imapPassword":"pw"}}}"#)

		let database = try TobyDatabase.open(paths: fixture.paths)
		let secrets = InMemorySecretStore()
		let saved = SavedKey()
		let importer = LegacyImporter(
			paths: fixture.paths,
			database: database,
			secrets: secrets,
			openRouterKeyStore: { saved.save($0) },
			credentialsDataKey: { _, _ in nil },
		)
		let legacyChatBefore = try Data(contentsOf: fixture.paths.legacyChatDatabase)

		let report = try importer.run()

		#expect(report.rowsByTable["chat_sessions"] == 1)
		#expect(report.rowsByTable["chat_session_messages"] == 4)
		#expect(report.rowsByTable["todo_entities"] == 1)
		#expect(report.rowsByTable["memory_items"] == 1)
		#expect(report.rowsByTable["todo_device_state"] == 1)
		#expect(report.rowsByTable["user_tools"] == nil)
		#expect(report.rowsByTable["chat_plans"] == 1)
		#expect(report.orphansDropped == ["chat_plans": 1])
		#expect(report.messagesConverted == 4)
		#expect(report.importedOpenRouterKey)
		#expect(saved.value == "sk-or-legacy")
		#expect(secrets.all == ["mail.imapPassword": "pw"])
		#expect(try importer.hasImported())

		// Converted messages decode as TobyAI messages.
		let stored = try database.writer.read { db in
			try String.fetchAll(db, sql: "SELECT message_json FROM chat_session_messages ORDER BY idx")
		}
		let decoded = try stored.map { try JSONDecoder().decode([Message].self, from: Data($0.utf8)) }
		#expect(decoded[0].first?.text == "What is due today?")
		#expect(decoded[1].first?.toolCalls.first?.name == "listTobyTodos")
		#expect(decoded[2].first?.role == .tool)
		#expect(decoded[3].first?.text == "Nothing is due.")

		// Embedding blobs survive byte-for-byte.
		let blob = try database.writer.read { db in
			try Data.fetchOne(db, sql: "SELECT embedding_blob FROM memory_embeddings WHERE memory_id = 'm1'")
		}
		#expect(blob.map(VectorMath.vector(fromBlob:)) == [0.25, 0.5])

		// The legacy file is untouched.
		#expect(try Data(contentsOf: fixture.paths.legacyChatDatabase) == legacyChatBefore)
	}

	@Test func isIdempotent() throws {
		let fixture = try LegacyHomeFixture()
		defer { fixture.cleanup() }
		try fixture.makeChatDatabase()
		let database = try TobyDatabase.open(paths: fixture.paths)
		let importer = LegacyImporter(paths: fixture.paths, database: database, secrets: InMemorySecretStore(), openRouterKeyStore: nil)

		_ = try importer.run()
		let second = try importer.run()
		#expect(second.skipped)

		let forced = try importer.run(force: true)
		#expect(forced.rowsByTable["chat_session_messages"] == 0)
		#expect(try database.count("chat_session_messages") == 4)
		#expect(try database.count("chat_sessions") == 1)
	}

	@Test func existingNativeSecretsWin() throws {
		let fixture = try LegacyHomeFixture()
		defer { fixture.cleanup() }
		try fixture.writeCredentials(#"{"slack":{"botToken":"legacy"}}"#)
		let secrets = InMemorySecretStore(["slack.botToken": "native"])
		let importer = LegacyImporter(
			paths: fixture.paths,
			database: try TobyDatabase.open(paths: fixture.paths),
			secrets: secrets,
			openRouterKeyStore: nil,
		)
		let report = try importer.run()
		#expect(report.secretsImported.isEmpty)
		#expect(secrets.all["slack.botToken"] == "native")
	}

	@Test func unreadableCredentialsWarnInsteadOfFailing() throws {
		let fixture = try LegacyHomeFixture()
		defer { fixture.cleanup() }
		let envelope = try LegacyCredentials.encryptForTesting(Data("{}".utf8), key: Data(repeating: 1, count: 32))
		try fixture.writeCredentials(envelope.jsonString())
		let importer = LegacyImporter(
			paths: fixture.paths,
			database: try TobyDatabase.open(paths: fixture.paths),
			secrets: InMemorySecretStore(),
			openRouterKeyStore: nil,
			credentialsDataKey: { _, _ in nil },
		)
		let report = try importer.run()
		#expect(report.warnings.count == 1)
		#expect(try importer.hasImported())
	}

	@Test func emptyHomeImportsNothing() throws {
		let fixture = try LegacyHomeFixture()
		defer { fixture.cleanup() }
		let database = try TobyDatabase.open(paths: fixture.paths)
		let report = try LegacyImporter(paths: fixture.paths, database: database, secrets: InMemorySecretStore(), openRouterKeyStore: nil).run()
		#expect(report.rowsByTable.isEmpty)
		#expect(FileManager.default.fileExists(atPath: fixture.paths.database.path))
	}
}
