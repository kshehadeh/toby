import CryptoKit
import Foundation
import GRDB
import TobyAI

/// A last-writer-wins register: `{value, stamp}`.
struct TodoRegister: Sendable, Hashable {
	var value: JSONValue
	var stamp: String
}

/// A CRDT record (`todo`, `occurrence`, `list`, or `tag`) materialized from the
/// operation log. JSON shape matches the daemon's `todo_entities.data`.
struct TodoEntity: Sendable, Hashable {
	var kind: String
	var id: String
	var fields: [String: TodoRegister]

	init(kind: String, id: String, fields: [String: TodoRegister] = [:]) {
		self.kind = kind
		self.id = id
		self.fields = fields
	}

	init(json: JSONValue) {
		kind = json["kind"]?.stringValue ?? ""
		id = json["id"]?.stringValue ?? ""
		var fields: [String: TodoRegister] = [:]
		for (key, register) in json["fields"]?.objectValue ?? [:] {
			fields[key] = TodoRegister(value: register["value"] ?? .null, stamp: register["stamp"]?.stringValue ?? "")
		}
		self.fields = fields
	}

	var json: JSONValue {
		[
			"kind": .string(kind),
			"id": .string(id),
			"fields": .object(fields.mapValues { ["value": $0.value, "stamp": .string($0.stamp)] }),
		]
	}

	var values: [String: JSONValue] { fields.mapValues(\.value) }

	/// Opaque content hash used for optimistic concurrency.
	var revision: String {
		TodoHash.hex(.object(fields.mapValues { ["stamp": .string($0.stamp), "value": $0.value] }))
	}
}

/// One change inside an operation.
struct TodoChange: Sendable, Hashable {
	var kind: String
	var id: String
	var fields: [String: JSONValue]

	var json: JSONValue { ["kind": .string(kind), "id": .string(id), "fields": .object(fields)] }
}

/// An immutable, replicated operation (`version: 1`).
struct TodoOperation: Sendable, Hashable {
	var id: String
	var replica: String
	var clock: Int
	var at: String
	var source: String
	var changes: [TodoChange]

	var json: JSONValue {
		[
			"version": 1,
			"id": .string(id),
			"replica": .string(replica),
			"clock": .number(Double(clock)),
			"at": .string(at),
			"source": .string(source),
			"changes": .array(changes.map(\.json)),
		]
	}

	/// Total order across replicas: zero-padded clock, then replica, then id.
	var stamp: String {
		"\(String(repeating: "0", count: max(0, 16 - String(clock).count)))\(clock):\(replica):\(id)"
	}

	/// Parse and validate (port of `parseTodoOperation`).
	static func parse(_ value: JSONValue) throws -> TodoOperation {
		guard value["version"]?.intValue == 1 else { throw TodoError.invalid("Unsupported operation version.") }
		let allowed: Set<String> = ["version", "id", "replica", "clock", "at", "source", "changes"]
		if let extra = value.objectValue?.keys.first(where: { !allowed.contains($0) }) {
			throw TodoError.invalid("Unrecognized operation key: \(extra)")
		}
		let id = try TodoSchema.id(value["id"], "operation id")
		let replica = try TodoSchema.id(value["replica"], "replica")
		guard let clock = value["clock"]?.doubleValue, clock == clock.rounded(), clock >= 1, clock < 9_007_199_254_740_990 else {
			throw TodoError.invalid("Invalid operation clock.")
		}
		guard let at = value["at"]?.stringValue, TodoSchema.isDateTime(at) else { throw TodoError.invalid("Invalid operation time.") }
		guard let source = value["source"]?.stringValue, (1 ... 200).contains(source.count) else {
			throw TodoError.invalid("Invalid operation source.")
		}
		guard let rawChanges = value["changes"]?.arrayValue, (1 ... 20000).contains(rawChanges.count) else {
			throw TodoError.invalid("An operation needs 1–20000 changes.")
		}
		let changes = try rawChanges.map(TodoChangeValidator.parse)
		return TodoOperation(id: id, replica: replica, clock: Int(clock), at: at, source: source, changes: changes)
	}
}

/// Per-field validation of incoming changes (port of `changeSchema.superRefine`).
enum TodoChangeValidator {
	static func parse(_ value: JSONValue) throws -> TodoChange {
		guard let kind = value["kind"]?.stringValue, ["todo", "occurrence", "list", "tag"].contains(kind) else {
			throw TodoError.invalid("Invalid change kind.")
		}
		let id = try TodoSchema.id(value["id"], "change id")
		guard let fields = value["fields"]?.objectValue, fields.count <= 1000 else { throw TodoError.invalid("Invalid change fields.") }
		for (key, field) in fields {
			guard key.count <= 240, isValid(kind: kind, key: key, value: field) else {
				throw TodoError.invalid("Invalid \(kind) field: \(key)")
			}
			if case .object = field, key.hasPrefix("check:") || key.hasPrefix("reminder:") {
				let elementID = String(key.dropFirst(key.hasPrefix("check:") ? 6 : 9))
				guard field["id"]?.stringValue == elementID else { throw TodoError.invalid("Element ID does not match its field") }
			}
		}
		return TodoChange(kind: kind, id: id, fields: fields)
	}

	static func isValid(kind: String, key: String, value: JSONValue) -> Bool {
		func valid(_ body: () throws -> Void) -> Bool { (try? body()) != nil }
		if kind == "list" || kind == "tag" {
			if key == "name" {
				return value.stringValue.map { (1 ... 200).contains($0.trimmingCharacters(in: .whitespacesAndNewlines).count) } ?? false
			}
			return key == "deleted" && value.boolValue != nil
		}
		if TodoSchema.todoFieldKeys.contains(key) {
			return valid { _ = try TodoSchema.fields(partial: [key: value], applyDefaults: false) }
		}
		if key.hasPrefix("check:"), TodoSchema.isID(String(key.dropFirst(6))) {
			return value.isNull || valid { _ = try TodoSchema.checklistItem(value) }
		}
		if key.hasPrefix("reminder:"), TodoSchema.isID(String(key.dropFirst(9))) {
			return value.isNull || valid { _ = try TodoSchema.reminder(value) }
		}
		if kind == "todo" {
			switch key {
			case "anchor": return valid { _ = try TodoSchema.nullableDue(value) }
			case "deleted": return value.boolValue != nil
			case "createdAt", "updatedAt": return value.stringValue.map(TodoSchema.isDateTime) ?? false
			default:
				return key.hasPrefix("tag:") && TodoSchema.isID(String(key.dropFirst(4))) && value.boolValue != nil
			}
		}
		switch key {
		case "due": return valid { _ = try TodoSchema.nullableDue(value) }
		case "state": return isValidState(value)
		default: return false
		}
	}

	static func isValidState(_ value: JSONValue) -> Bool {
		let allowed: Set<String> = ["status", "at", "snapshot", "closedDue", "closedChecklist", "closedTags", "next"]
		guard let object = value.objectValue, object.keys.allSatisfy(allowed.contains) else { return false }
		guard let status = object["status"]?.stringValue, ["open", "completed", "skipped"].contains(status) else { return false }
		guard let at = object["at"], at.isNull || (at.stringValue.map(TodoSchema.isDateTime) ?? false) else { return false }
		if let snapshot = object["snapshot"] {
			guard let fields = snapshot.objectValue, (try? TodoSchema.fields(fields)) != nil else { return false }
		}
		if let closedDue = object["closedDue"], (try? TodoSchema.nullableDue(closedDue)) == nil { return false }
		if let checklist = object["closedChecklist"] {
			guard let items = checklist.arrayValue, items.count <= 200,
			      items.allSatisfy({ (try? TodoSchema.checklistItem($0)) != nil }) else { return false }
		}
		if let tags = object["closedTags"] {
			guard let items = tags.arrayValue, items.count <= 100,
			      items.allSatisfy({ $0.stringValue.map(TodoSchema.isID) ?? false }) else { return false }
		}
		if let next = object["next"], !next.isNull {
			guard let nextObject = next.objectValue, Set(nextObject.keys) == ["due", "checklist"],
			      (try? TodoSchema.due(nextObject["due"] ?? .null)) != nil,
			      let items = nextObject["checklist"]?.arrayValue, items.count <= 200,
			      items.allSatisfy({ (try? TodoSchema.checklistItem($0)) != nil }) else { return false }
		}
		return true
	}
}

enum TodoHash {
	/// SHA-256 hex of canonical (sorted-key) JSON.
	static func hex(_ value: JSONValue) -> String {
		SHA256.hash(data: Data(value.jsonString().utf8)).map { String(format: "%02x", $0) }.joined()
	}
}

/// Persistence for the todo CRDT (port of `packages/core/src/todos/store.ts`).
struct TodoStore: Sendable {
	let writer: any DatabaseWriter
	/// Touched after each applied operation so reminder scheduling reconciles.
	let changeMarker: URL?

	func entity(_ db: Database, kind: String, id: String) throws -> TodoEntity? {
		try String.fetchOne(db, sql: "SELECT data FROM todo_entities WHERE kind = ? AND id = ?", arguments: [kind, id])
			.map { TodoEntity(json: try JSONValue(parsing: $0)) }
	}

	func entities(_ db: Database, kind: String) throws -> [TodoEntity] {
		try String.fetchAll(db, sql: "SELECT data FROM todo_entities WHERE kind = ? ORDER BY id", arguments: [kind])
			.map { TodoEntity(json: try JSONValue(parsing: $0)) }
	}

	func localValue(_ db: Database, _ key: String) throws -> String? {
		try String.fetchOne(db, sql: "SELECT value FROM todo_local WHERE key = ?", arguments: [key])
	}

	func setLocalValue(_ db: Database, _ key: String, _ value: String) throws {
		try db.execute(sql: "INSERT OR REPLACE INTO todo_local(key, value) VALUES (?, ?)", arguments: [key, value])
	}

	/// Apply an operation once. Returns false if it was already applied.
	/// Re-delivery is compared semantically (JSON key order may differ between
	/// the TS daemon and Swift); different content under the same id conflicts.
	@discardableResult
	func apply(_ db: Database, _ op: TodoOperation) throws -> Bool {
		if let existing = try String.fetchOne(db, sql: "SELECT data FROM todo_operations WHERE id = ?", arguments: [op.id]) {
			guard let parsed = try? TodoOperation.parse(JSONValue(parsing: existing)), parsed == op else {
				throw TodoError("operation_conflict", "An operation ID was reused with different content.", status: 409)
			}
			return false
		}
		let stamp = op.stamp
		for change in op.changes {
			var record = try entity(db, kind: change.kind, id: change.id) ?? TodoEntity(kind: change.kind, id: change.id)
			for (key, value) in change.fields {
				if let current = record.fields[key], current.stamp >= stamp { continue }
				record.fields[key] = TodoRegister(value: value, stamp: stamp)
			}
			try db.execute(
				sql: "INSERT OR REPLACE INTO todo_entities(kind, id, data) VALUES (?, ?, ?)",
				arguments: [record.kind, record.id, record.json.jsonString()],
			)
		}
		try db.execute(
			sql: "INSERT INTO todo_operations(id, replica, clock, data) VALUES (?, ?, ?, ?)",
			arguments: [op.id, op.replica, op.clock, op.json.jsonString()],
		)
		let previous = Int(try localValue(db, "clock") ?? "0") ?? 0
		if op.clock > previous { try setLocalValue(db, "clock", String(op.clock)) }
		return true
	}

	func operations(_ db: Database) throws -> [TodoOperation] {
		try String.fetchAll(db, sql: "SELECT data FROM todo_operations ORDER BY clock, replica, id")
			.compactMap { try? TodoOperation.parse(JSONValue(parsing: $0)) }
	}

	func notifyChanged() {
		guard let changeMarker else { return }
		let now = Date()
		if (try? FileManager.default.setAttributes([.modificationDate: now], ofItemAtPath: changeMarker.path)) == nil {
			try? Data(String(Int(now.timeIntervalSince1970 * 1000)).utf8).write(to: changeMarker)
		}
	}
}
