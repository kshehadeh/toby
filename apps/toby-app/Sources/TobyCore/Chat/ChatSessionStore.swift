import Foundation
import GRDB
import TobyAI
import TobyStore

/// Chat session rows (port of the session parts of `session-store.ts`).
/// The chat engine (M4) builds on this; projects use it today.
public struct ChatSessionStore: Sendable {
	let writer: any DatabaseWriter

	public init(writer: any DatabaseWriter) {
		self.writer = writer
	}

	static func summary(_ row: Row, includeExternal: Bool) -> JSONValue {
		var object: [String: JSONValue] = [
			"id": .string(row["id"]),
			"name": .string(row["name"]),
			"createdAt": .string(row["created_at"]),
			"updatedAt": .string(row["updated_at"]),
			"projectId": (row["project_id"] as String?).map(JSONValue.string) ?? .null,
		]
		if includeExternal {
			for (column, key) in [
				("source_integration", "sourceIntegration"), ("source_display_name", "sourceDisplayName"),
				("external_key", "externalKey"), ("lifecycle_status", "lifecycleStatus"), ("last_remote_message_at", "lastRemoteMessageAt"),
			] {
				object[key] = (row[column] as String?).map(JSONValue.string) ?? .null
			}
		}
		return .object(object)
	}

	/// Create a session; `settings.projectId` links it to a project.
	public func create(name: String?, settings: JSONValue? = nil) throws -> JSONValue {
		let id = UUID().uuidString.lowercased()
		let ts = TodoRecurrence.isoString(Date())
		let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines)
		let resolvedName = trimmed?.isEmpty == false ? trimmed! : "New chat"
		let projectID = settings?["projectId"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
		try writer.write { db in
			try db.execute(sql: """
			INSERT INTO chat_sessions (id, name, project_id, created_at, updated_at, settings_json) VALUES (?, ?, ?, ?, ?, ?)
			""", arguments: [id, resolvedName, projectID, ts, ts, settings?.jsonString()])
		}
		return [
			"id": .string(id), "name": .string(resolvedName), "createdAt": .string(ts), "updatedAt": .string(ts),
			"projectId": projectID.map(JSONValue.string) ?? .null,
		]
	}

	/// Sessions outside any project, newest first (with external-source info).
	public func list(limit: Int = 50) throws -> [JSONValue] {
		try writer.read { db in
			try Row.fetchAll(db, sql: """
			SELECT s.id, s.name, s.project_id, s.created_at, s.updated_at,
			       es.integration AS source_integration, es.display_name AS source_display_name,
			       es.external_key, es.lifecycle_status, es.last_remote_message_at
			FROM chat_sessions s LEFT JOIN chat_external_sessions es ON es.session_id = s.id
			WHERE s.project_id IS NULL ORDER BY s.updated_at DESC LIMIT ?
			""", arguments: [max(1, min(500, limit))]).map { Self.summary($0, includeExternal: true) }
		}
	}

	public func list(projectID: String, limit: Int = 20) throws -> [JSONValue] {
		let trimmed = projectID.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return [] }
		return try writer.read { db in
			try Row.fetchAll(db, sql: """
			SELECT id, name, project_id, created_at, updated_at FROM chat_sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?
			""", arguments: [trimmed, max(1, min(100, limit))]).map { Self.summary($0, includeExternal: false) }
		}
	}

	public func rename(_ id: String, to name: String) throws {
		let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		try writer.write { db in
			try db.execute(sql: "UPDATE chat_sessions SET name = ?, updated_at = ? WHERE id = ?", arguments: [trimmed, TodoRecurrence.isoString(Date()), id])
		}
	}

	public func delete(_ id: String) throws {
		try writer.write { db in
			try db.execute(sql: "DELETE FROM chat_sessions WHERE id = ?", arguments: [id])
		}
	}
}

// MARK: - Full sessions (chat engine)

/// A loaded chat session.
public struct ChatSession: Sendable {
	public var id: String
	public var name: String
	public var settings: JSONValue
	public var messages: [Message]
	public var transcript: [JSONValue]
	public var contextWindow: JSONValue?
	public var projectID: String? { settings["projectId"]?.stringValue }
	public var personaName: String? { settings["persona"]?.stringValue }
}

extension ChatSessionStore {
	public func load(_ id: String) throws -> ChatSession? {
		try writer.read { db in
			guard let row = try Row.fetchOne(db, sql: "SELECT * FROM chat_sessions WHERE id = ?", arguments: [id]) else { return nil }
			var settings = (row["settings_json"] as String?).flatMap { try? JSONValue(parsing: $0) } ?? .object([:])
			if case var .object(object) = settings, object["projectId"] == nil, let project: String = row["project_id"] {
				object["projectId"] = .string(project)
				settings = .object(object)
			}
			let decoder = JSONDecoder()
			var messages: [Message] = []
			for message in try Row.fetchAll(db, sql: "SELECT role, content_json, message_json FROM chat_session_messages WHERE session_id = ? ORDER BY idx", arguments: [id]) {
				if let json: String = message["message_json"], let decoded = try? decoder.decode([Message].self, from: Data(json.utf8)) {
					messages += decoded
				} else {
					messages += LegacyMessageConverter.convert(role: message["role"], contentJSON: message["content_json"])
				}
			}
			let transcript = try Row.fetchAll(db, sql: "SELECT kind, text FROM chat_session_transcript WHERE session_id = ? ORDER BY idx", arguments: [id])
				.map { ChatTranscript.entry(kind: $0["kind"], text: $0["text"]) }
			return ChatSession(
				id: id, name: row["name"], settings: settings, messages: messages, transcript: transcript,
				contextWindow: (row["context_window_json"] as String?).flatMap { try? JSONValue(parsing: $0) },
			)
		}
	}

	/// Append a turn's messages and replace transcript rows from `transcriptFrom`.
	public func saveTurn(_ id: String, messages: [Message], transcript: [JSONValue], transcriptFrom: Int, contextWindow: JSONValue?) throws {
		let encoder = JSONEncoder()
		encoder.outputFormatting = [.sortedKeys]
		try writer.write { db in
			var next = (try Int.fetchOne(db, sql: "SELECT MAX(idx) FROM chat_session_messages WHERE session_id = ?", arguments: [id]) ?? -1) + 1
			for message in messages {
				let json = String(decoding: try encoder.encode([message]), as: UTF8.self)
				try db.execute(sql: "INSERT INTO chat_session_messages (session_id, idx, role, content_json, message_json) VALUES (?, ?, ?, ?, ?)",
				               arguments: [id, next, message.role.rawValue, json, json])
				next += 1
			}
			try db.execute(sql: "DELETE FROM chat_session_transcript WHERE session_id = ? AND idx >= ?", arguments: [id, transcriptFrom])
			for (offset, entry) in transcript.enumerated() where offset >= transcriptFrom {
				let row = ChatTranscript.row(entry)
				try db.execute(sql: "INSERT INTO chat_session_transcript (session_id, idx, kind, text) VALUES (?, ?, ?, ?)", arguments: [id, offset, row.kind, row.text])
			}
			try db.execute(sql: "UPDATE chat_sessions SET updated_at = ?, context_window_json = COALESCE(?, context_window_json) WHERE id = ?",
			               arguments: [TodoRecurrence.isoString(Date()), contextWindow?.jsonString(), id])
		}
	}

	public func updateSettings(_ id: String, _ settings: JSONValue) throws {
		try writer.write { db in
			try db.execute(sql: "UPDATE chat_sessions SET settings_json = ?, project_id = ? WHERE id = ?",
			               arguments: [settings.jsonString(), settings["projectId"]?.stringValue, id])
		}
	}
}
