import Foundation
import GRDB
import TobyAI

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
