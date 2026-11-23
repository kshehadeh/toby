import Foundation
import GRDB
import TobyAI
import TobyStore

/// Toby's built-in todo system (port of `packages/core/src/todos/service.ts`).
///
/// Todos are a CRDT: every mutation is an immutable operation of field changes
/// with a Lamport-style stamp; entities are last-writer-wins per field. Results
/// are JSON in the same shape as the daemon's `/api/todos` so existing UI models
/// decode them unchanged.
public final class TodoService: Sendable {
	let store: TodoStore
	let replicaFile: URL
	let restoreMarker: URL

	public init(writer: any DatabaseWriter, tobyDirectory: URL) {
		store = TodoStore(writer: writer, changeMarker: tobyDirectory.appending(path: ".todos-changed"))
		replicaFile = tobyDirectory.appending(path: "todo-replica")
		restoreMarker = tobyDirectory.appending(path: "todo-restore-review.json")
	}

	/// Whether this service reads from `database` (cache invalidation on home switch).
	public func isBacked(by database: TobyDatabase) -> Bool {
		(store.writer as AnyObject) === (database.writer as AnyObject)
	}

	// MARK: Identity

	/// This Mac's replica id, kept outside SQLite so restoring another Mac's
	/// database never clones its identity.
	public func replica() throws -> String {
		if !FileManager.default.fileExists(atPath: replicaFile.path) {
			try? FileManager.default.createDirectory(at: replicaFile.deletingLastPathComponent(), withIntermediateDirectories: true)
			FileManager.default.createFile(
				atPath: replicaFile.path,
				contents: Data(UUID().uuidString.lowercased().utf8),
				attributes: [.posixPermissions: 0o600],
			)
		}
		let id = try String(contentsOf: replicaFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
		guard TodoSchema.isID(id) else { throw TodoError("invalid_replica", "This Mac's todo replica id is invalid.") }
		return id
	}

	static func occurrenceID(_ id: String, _ sequence: Int) -> String { "\(id):\(sequence)" }

	// MARK: Reads

	public func get(_ id: String, sequence: Int? = nil) throws -> JSONValue {
		try store.writer.read { db in try self.todo(db, id: id, sequence: sequence) }
	}

	func requireEntity(_ db: Database, kind: String, id: String) throws -> TodoEntity {
		guard TodoSchema.isID(id), let record = try store.entity(db, kind: kind, id: id),
		      kind != "todo" || record.fields["createdAt"] != nil
		else { throw TodoError("not_found", "\(kind) not found or still downloading.", status: 404) }
		return record
	}

	static func dictionary(_ fields: [String: JSONValue], prefix: String) -> [JSONValue] {
		fields.filter { $0.key.hasPrefix(prefix) && !$0.value.isNull }.sorted { $0.key < $1.key }.map(\.value)
	}

	static func unchecked(_ item: JSONValue) -> JSONValue {
		guard case var .object(object) = item else { return item }
		object["checked"] = false
		return .object(object)
	}

	/// Materialize a todo (current occurrence, or a specific `sequence`).
	func todo(_ db: Database, id: String, sequence: Int? = nil) throws -> JSONValue {
		let record = try requireEntity(db, kind: "todo", id: id)
		let fields = record.values
		var seq = 0
		var due: JSONValue = fields["anchor"] ?? .null
		var baseChecklist = Self.dictionary(fields, prefix: "check:").map(Self.unchecked)
		var occurrenceFields: [String: JSONValue] = [:]
		var state: JSONValue = ["status": "open", "at": .null]
		var occurrenceRevision = ""
		var occurrenceStamps: [String: TodoRegister] = [:]

		while true {
			let occurrence = try store.entity(db, kind: "occurrence", id: Self.occurrenceID(id, seq))
			occurrenceFields = occurrence?.values ?? [:]
			if let occurrenceDue = occurrenceFields["due"] { due = occurrenceDue }
			state = occurrenceFields["state"] ?? ["status": "open", "at": .null]
			occurrenceRevision = occurrence?.revision ?? ""
			occurrenceStamps = occurrence?.fields ?? [:]
			let status = state["status"]?.stringValue ?? "open"
			guard seq != sequence, status != "open", let next = state["next"], !next.isNull else { break }
			due = next["due"] ?? .null
			baseChecklist = next["checklist"]?.arrayValue ?? []
			seq += 1
			if seq > 100_000 { throw TodoError("invalid_history", "Occurrence history is too large.") }
		}
		if let sequence, seq != sequence {
			throw TodoError("occurrence_not_found", "Occurrence is not active in this series.", status: 404)
		}

		var items: [String: JSONValue] = [:]
		for item in baseChecklist {
			if let itemID = item["id"]?.stringValue { items[itemID] = item }
		}
		for (key, value) in occurrenceFields where key.hasPrefix("check:") {
			let itemID = String(key.dropFirst(6))
			items[itemID] = value.isNull ? nil : value
		}
		var reminderItems: [String: JSONValue] = [:]
		for reminder in Self.dictionary(fields, prefix: "reminder:") {
			if let reminderID = reminder["id"]?.stringValue { reminderItems[reminderID] = reminder }
		}
		for (key, value) in occurrenceFields where key.hasPrefix("reminder:") {
			reminderItems[String(key.dropFirst(9))] = value.isNull ? nil : value
		}
		var tags: [String] = []
		for (key, value) in fields.sorted(by: { $0.key < $1.key }) where key.hasPrefix("tag:") && value == true {
			let tagID = String(key.dropFirst(4))
			let tag = try store.entity(db, kind: "tag", id: tagID)
			if tag?.values["deleted"] != true { tags.append(tagID) }
		}

		let closed = state["status"]?.stringValue != "open"
		var overrides = occurrenceFields.filter { TodoSchema.todoFieldKeys.contains($0.key) }
		for key in overrides.keys {
			if let definition = record.fields[key]?.stamp, let occurrence = occurrenceStamps[key]?.stamp, definition > occurrence {
				overrides.removeValue(forKey: key)
			}
		}
		var source: [String: JSONValue]
		if closed, let snapshot = state["snapshot"]?.objectValue {
			source = snapshot
		} else {
			source = fields.filter { TodoSchema.todoFieldKeys.contains($0.key) }
			source.merge(overrides) { _, override in override }
		}
		var parsed = try TodoSchema.fields(source)
		if let listID = parsed["listId"]?.stringValue, listID != "inbox",
		   try store.entity(db, kind: "list", id: listID)?.fields["deleted"]?.value == true
		{
			parsed["listId"] = "inbox"
		}

		let checklist: [JSONValue] = if closed, let closedChecklist = state["closedChecklist"]?.arrayValue {
			closedChecklist
		} else {
			items.values.sorted {
				let a = $0["order"]?.doubleValue ?? 0
				let b = $1["order"]?.doubleValue ?? 0
				return a != b ? a < b : ($0["id"]?.stringValue ?? "") < ($1["id"]?.stringValue ?? "")
			}
		}
		let revision = TodoHash.hex([
			.string(record.revision), .string(occurrenceRevision), .number(Double(seq)), due, .array(baseChecklist),
		])

		var result = parsed
		result["id"] = .string(id)
		result["revision"] = .string(revision)
		result["createdAt"] = fields["createdAt"].map { .string($0.stringValue ?? "") } ?? ""
		result["updatedAt"] = fields["updatedAt"].map { .string($0.stringValue ?? "") } ?? ""
		result["deleted"] = .bool(fields["deleted"] == true)
		result["occurrenceId"] = .string(Self.occurrenceID(id, seq))
		result["sequence"] = .number(Double(seq))
		if closed, let stateObject = state.objectValue, stateObject.keys.contains("closedDue") {
			result["due"] = stateObject["closedDue"] ?? .null
		} else {
			result["due"] = due
		}
		result["state"] = state
		result["tags"] = closed && state["closedTags"] != nil ? state["closedTags"]! : .array(tags.map(JSONValue.string))
		result["checklist"] = .array(checklist)
		result["reminders"] = .array(reminderItems.keys.sorted().compactMap { reminderItems[$0] })
		return .object(result)
	}

	/// `listTodos` filters: query, status, listId, projectId, tagId, priority,
	/// dueFrom, dueTo, limit (1…200, default 50), offset.
	public func list(_ raw: JSONValue = .object([:])) throws -> JSONValue {
		let allowed: Set<String> = ["query", "status", "listId", "projectId", "tagId", "priority", "dueFrom", "dueTo", "limit", "offset"]
		let filter = try TodoSchema.object(raw, "filter", allowed: allowed)
		let status = filter["status"]?.stringValue ?? "open"
		guard ["open", "completed", "all", "deleted"].contains(status) else { throw TodoError.invalid("Invalid status.") }
		let limit = try TodoSchema.int(filter["limit"], "limit", min: 1) ?? 50
		guard limit <= 200 else { throw TodoError.invalid("limit must be at most 200.") }
		let offset = try TodoSchema.int(filter["offset"], "offset") ?? 0
		let needle = filter["query"]?.stringValue?.lowercased()

		return try store.writer.read { db in
			var todos: [JSONValue] = []
			for record in try self.store.entities(db, kind: "todo") where record.fields["createdAt"] != nil {
				let current = try self.todo(db, id: record.id)
				if status != "completed" {
					todos.append(current)
					continue
				}
				let latest = current["sequence"]?.intValue ?? 0
				for seq in 0 ... latest {
					let item = try self.todo(db, id: record.id, sequence: seq)
					if item["state"]?["status"] == "completed" { todos.append(item) }
				}
			}
			todos = todos.filter { todo in
				let deleted = todo["deleted"] == true
				if (status == "deleted") != deleted { return false }
				if status == "open", todo["state"]?["status"] != "open" { return false }
				if let listID = filter["listId"]?.stringValue, todo["listId"]?.stringValue != listID { return false }
				if let projectID = filter["projectId"]?.stringValue, todo["projectId"]?.stringValue != projectID { return false }
				if let tagID = filter["tagId"]?.stringValue, !(todo["tags"]?.arrayValue ?? []).contains(.string(tagID)) { return false }
				if let priority = filter["priority"]?.stringValue, todo["priority"]?.stringValue != priority { return false }
				let dueDate = todo["due"]?["date"]?.stringValue
				if let from = filter["dueFrom"]?.stringValue, dueDate.map({ $0 < from }) ?? true { return false }
				if let to = filter["dueTo"]?.stringValue, dueDate.map({ $0 > to }) ?? true { return false }
				guard let needle, !needle.isEmpty else { return true }
				let haystack = "\(todo["title"]?.stringValue ?? "")\n\(todo["description"]?.stringValue ?? "")".lowercased()
				return haystack.contains(needle)
			}
			todos.sort(by: Self.dueOrder)
			let page = todos.dropFirst(offset).prefix(limit)
			return ["todos": .array(Array(page)), "total": .number(Double(todos.count))]
		}
	}

	static func dueOrder(_ a: JSONValue, _ b: JSONValue) -> Bool {
		let left = a["due"]?["date"]?.stringValue ?? "9999"
		let right = b["due"]?["date"]?.stringValue ?? "9999"
		return left != right ? left < right : (a["id"]?.stringValue ?? "") < (b["id"]?.stringValue ?? "")
	}

	// MARK: Mutations

	struct Built {
		var changes: [TodoChange]
		var result: (Database) throws -> JSONValue
	}

	/// Run a mutation: idempotency check, build changes, stamp `updatedAt` on
	/// touched todos, append one operation, return the result.
	func transact(
		_ action: String,
		input: JSONValue,
		context: TodoMutationContext,
		build: @escaping (Database) throws -> Built,
	) throws -> JSONValue {
		let now = context.now ?? TodoRecurrence.isoString(Date())
		let replica = try replica()
		var applied = false
		let result: JSONValue = try store.writer.write { db in
			let fingerprint = TodoHash.hex(["action": .string(action), "input": input])
			if let key = context.idempotencyKey,
			   let cached = try Row.fetchOne(db, sql: "SELECT fingerprint, result FROM todo_requests WHERE key = ?", arguments: [key])
			{
				guard (cached["fingerprint"] as String) == fingerprint else {
					throw TodoError("idempotency_conflict", "This idempotency key was already used for different inputs.", status: 409)
				}
				return try JSONValue(parsing: cached["result"])
			}
			var built = try build(db)
			var touched = Set<String>()
			for change in built.changes {
				if change.kind == "todo" { touched.insert(change.id) }
				if change.kind == "occurrence", let colon = change.id.lastIndex(of: ":") {
					touched.insert(String(change.id[..<colon]))
				}
			}
			for todoID in touched.sorted() {
				if let index = built.changes.firstIndex(where: { $0.kind == "todo" && $0.id == todoID }) {
					built.changes[index].fields["updatedAt"] = .string(now)
				} else {
					built.changes.append(TodoChange(kind: "todo", id: todoID, fields: ["updatedAt": .string(now)]))
				}
			}
			if context.dryRun {
				return ["dryRun": true, "changes": .array(built.changes.map(\.json))]
			}
			let clock = (Int(try self.store.localValue(db, "clock") ?? "0") ?? 0) + 1
			let op = TodoOperation(
				id: UUID().uuidString.lowercased(),
				replica: replica,
				clock: clock,
				at: now,
				source: context.source ?? "api",
				changes: built.changes,
			)
			applied = try self.store.apply(db, op)
			let result = try built.result(db)
			try context.onCommit?(db, result)
			if let key = context.idempotencyKey {
				try db.execute(
					sql: "INSERT INTO todo_requests(key, fingerprint, result) VALUES (?, ?, ?)",
					arguments: [key, fingerprint, result.jsonString()],
				)
			}
			return result
		}
		if applied { store.notifyChanged() }
		return result
	}

	func namedAvailable(_ db: Database, kind: String, id: String) throws {
		if kind == "list", id == "inbox" { return }
		if try requireEntity(db, kind: kind, id: id).values["deleted"] == true {
			throw TodoError("deleted", "\(kind) was deleted.")
		}
	}

	func editable(_ db: Database, id: String, context: TodoMutationContext, sequence: Int? = nil) throws -> JSONValue {
		let todo = try todo(db, id: id, sequence: sequence)
		try checkRevision(todo, context)
		if todo["deleted"] == true { throw TodoError("deleted", "Restore this todo before editing.", status: 409) }
		return todo
	}

	func checkRevision(_ todo: JSONValue, _ context: TodoMutationContext) throws {
		if let expected = context.expectedRevision, !expected.isEmpty, expected != todo["revision"]?.stringValue {
			throw TodoError("revision_conflict", "This todo changed. Reload it before saving.", status: 409)
		}
	}

	/// Create a todo: todo fields plus `due`, `tags`, `checklist` (strings), `remind`.
	public func create(_ raw: JSONValue, context: TodoMutationContext = TodoMutationContext()) throws -> JSONValue {
		var object = try TodoSchema.object(raw, "todo", allowed: Set(TodoSchema.todoFieldKeys + ["due", "tags", "checklist", "remind"]))
		let due = try TodoSchema.nullableDue(object.removeValue(forKey: "due"))
		let tags = try (object.removeValue(forKey: "tags")?.arrayValue ?? []).map { try TodoSchema.id($0, "tag") }
		guard tags.count <= 100 else { throw TodoError.invalid("Too many tags.") }
		let checklist = try (object.removeValue(forKey: "checklist")?.arrayValue ?? []).map { item -> String in
			guard let text = item.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), (1 ... 2000).contains(text.count) else {
				throw TodoError.invalid("Checklist items need text.")
			}
			return text
		}
		guard checklist.count <= 200 else { throw TodoError.invalid("Too many checklist items.") }
		let remind = try TodoSchema.bool(object.removeValue(forKey: "remind"), default: false, "remind")
		let fields = try TodoSchema.fields(object)

		if fields["recurrence"] != .null, due.isNull {
			throw TodoError("due_required", "A repeating todo needs an initial due date.")
		}
		if remind, due["time"]?.stringValue == nil {
			throw TodoError("time_required", "A reminder needs a due date with a time. Ask for a time first.")
		}
		var input = fields
		input["due"] = due
		input["tags"] = .array(tags.map(JSONValue.string))
		input["checklist"] = .array(checklist.map(JSONValue.string))
		input["remind"] = .bool(remind)

		return try transact("create", input: .object(input), context: context) { db in
			try self.namedAvailable(db, kind: "list", id: fields["listId"]?.stringValue ?? "inbox")
			for tag in tags { try self.namedAvailable(db, kind: "tag", id: tag) }
			let id = context.internalTodoId ?? UUID().uuidString.lowercased()
			guard TodoSchema.isID(id) else { throw TodoError.invalid("Invalid todo id.") }
			let now = context.now ?? TodoRecurrence.isoString(Date())
			var record = fields
			record["anchor"] = due
			record["deleted"] = false
			record["createdAt"] = .string(now)
			record["updatedAt"] = .string(now)
			for tag in tags { record["tag:\(tag)"] = true }
			for (order, text) in checklist.enumerated() {
				let key = UUID().uuidString.lowercased()
				record["check:\(key)"] = ["id": .string(key), "text": .string(text), "order": .number(Double(order)), "checked": false]
			}
			if remind {
				record["reminder:due"] = ["id": "due", "at": .null, "offsetMinutes": 0, "snoozedUntil": .null]
			}
			return Built(changes: [TodoChange(kind: "todo", id: id, fields: record)]) { db in try self.todo(db, id: id) }
		}
	}

	/// Update fields. `scope: "occurrence"` (default) overrides the current
	/// occurrence; `"series"` edits the definition. `null` clears.
	public func update(_ id: String, _ raw: JSONValue, context: TodoMutationContext = TodoMutationContext()) throws -> JSONValue {
		var object = try TodoSchema.object(raw, "changes", allowed: Set(TodoSchema.todoFieldKeys + ["due", "scope"]))
		let scope = object.removeValue(forKey: "scope")?.stringValue ?? "occurrence"
		guard ["occurrence", "series"].contains(scope) else { throw TodoError.invalid("Invalid scope.") }
		let hasDue = object.keys.contains("due")
		let due = try TodoSchema.nullableDue(object.removeValue(forKey: "due"))
		let changes = try TodoSchema.fields(partial: object, applyDefaults: false)
		var input = changes
		input["id"] = .string(id)
		input["scope"] = .string(scope)
		if hasDue { input["due"] = due }

		return try transact("update", input: .object(input), context: context) { db in
			let todo = try self.editable(db, id: id, context: context)
			if let listID = changes["listId"]?.stringValue { try self.namedAvailable(db, kind: "list", id: listID) }
			// JS `input.due ?? todo.due`: an explicit null falls back to the current due.
			let effectiveDue = due.isNull ? (todo["due"] ?? .null) : due
			if let recurrence = changes["recurrence"], !recurrence.isNull, effectiveDue.isNull {
				throw TodoError("due_required", "A repeating todo needs a due date.")
			}
			let effectiveRecurrence = changes["recurrence"] ?? (todo["recurrence"] ?? .null)
			if hasDue, due.isNull, !effectiveRecurrence.isNull {
				throw TodoError("due_required", "Stop repeating before clearing the due date.")
			}
			var definition: [String: JSONValue] = [:]
			var overrides: [String: JSONValue] = [:]
			for (key, value) in changes {
				if scope == "occurrence", key != "recurrence" { overrides[key] = value } else { definition[key] = value }
			}
			if scope == "series", hasDue { definition["anchor"] = due }
			var built = [TodoChange(kind: "todo", id: id, fields: definition)]
			if hasDue { overrides["due"] = due }
			if !overrides.isEmpty {
				built.append(TodoChange(kind: "occurrence", id: todo["occurrenceId"]?.stringValue ?? "", fields: overrides))
			}
			return Built(changes: built) { db in try self.todo(db, id: id) }
		}
	}

	/// Complete, skip, or reopen an occurrence.
	public func transition(
		_ id: String,
		action: String,
		sequence: Int?,
		allowIncompleteChecklist: Bool = false,
		context: TodoMutationContext = TodoMutationContext(),
	) throws -> JSONValue {
		guard ["complete", "skip", "reopen"].contains(action) else { throw TodoError.invalid("Unknown action.") }
		var input: [String: JSONValue] = ["id": .string(id), "allowIncompleteChecklist": .bool(allowIncompleteChecklist)]
		if let sequence { input["sequence"] = .number(Double(sequence)) }

		return try transact(action, input: .object(input), context: context) { db in
			let todo = try self.editable(db, id: id, context: context, sequence: sequence)
			let todoSequence = todo["sequence"]?.intValue ?? 0
			let occurrenceID = todo["occurrenceId"]?.stringValue ?? ""
			var state: JSONValue
			if action == "reopen" {
				let current = try self.todo(db, id: id)
				let currentSequence = current["sequence"]?.intValue ?? 0
				if todo["state"]?["status"] == "open" {
					throw TodoError("already_open", "This occurrence is already open.", status: 409)
				}
				let laterOccurrence = try self.store.entity(db, kind: "occurrence", id: current["occurrenceId"]?.stringValue ?? "")
				let laterOccurrenceTouched = currentSequence == todoSequence + 1 && laterOccurrence != nil
				if currentSequence > todoSequence + 1 || laterOccurrenceTouched {
					throw TodoError("later_work", "Later occurrences have changed. Their history cannot be rewritten.", status: 409)
				}
				state = ["status": "open", "at": .null]
			} else {
				if todo["state"]?["status"] != "open" {
					throw TodoError("already_closed", "This occurrence is already closed.", status: 409)
				}
				let recurrence = todo["recurrence"] ?? .null
				if action == "skip", recurrence.isNull {
					throw TodoError("not_recurring", "Only repeating todos can be skipped.")
				}
				let checklist = todo["checklist"]?.arrayValue ?? []
				if action == "complete", !allowIncompleteChecklist, checklist.contains(where: { $0["checked"] != true }) {
					throw TodoError("incomplete_checklist", "Acknowledge unfinished checklist items before completing.", status: 409)
				}
				let at = context.now ?? TodoRecurrence.isoString(Date())
				let definition = try self.requireEntity(db, kind: "todo", id: id).values
				var next: JSONValue = .null
				if !recurrence.isNull, let currentDue = TodoDue(todo["due"]), let anchor = TodoDue(definition["anchor"]),
				   let nextDue = TodoRecurrence.nextDue(anchor: anchor, current: currentDue, rule: recurrence, completedAt: at)
				{
					next = [
						"due": nextDue.json,
						"checklist": .array(Self.dictionary(definition, prefix: "check:").map(Self.unchecked)),
					]
				}
				let snapshot = try TodoSchema.fields((todo.objectValue ?? [:]).filter { TodoSchema.todoFieldKeys.contains($0.key) })
				state = [
					"status": .string(action == "complete" ? "completed" : "skipped"),
					"at": .string(at),
					"snapshot": .object(snapshot),
					"closedDue": todo["due"] ?? .null,
					"closedChecklist": .array(checklist),
					"closedTags": todo["tags"] ?? [],
					"next": next,
				]
			}
			return Built(changes: [TodoChange(kind: "occurrence", id: occurrenceID, fields: ["state": state])]) { db in
				["occurrence": try self.todo(db, id: id, sequence: todoSequence), "todo": try self.todo(db, id: id)]
			}
		}
	}

	public func delete(_ id: String, restore: Bool = false, context: TodoMutationContext = TodoMutationContext()) throws -> JSONValue {
		try transact(restore ? "restore" : "delete", input: ["id": .string(id)], context: context) { db in
			try self.checkRevision(try self.todo(db, id: id), context)
			return Built(changes: [TodoChange(kind: "todo", id: id, fields: ["deleted": .bool(!restore)])]) { db in
				try self.todo(db, id: id)
			}
		}
	}

	public func setTag(_ id: String, tagID: String, enabled: Bool, context: TodoMutationContext = TodoMutationContext()) throws -> JSONValue {
		guard TodoSchema.isID(tagID) else { throw TodoError.invalid("Invalid tag id.") }
		return try transact("tag", input: ["id": .string(id), "tagId": .string(tagID), "enabled": .bool(enabled)], context: context) { db in
			_ = try self.editable(db, id: id, context: context)
			if enabled { try self.namedAvailable(db, kind: "tag", id: tagID) }
			return Built(changes: [TodoChange(kind: "todo", id: id, fields: ["tag:\(tagID)": .bool(enabled)])]) { db in
				try self.todo(db, id: id)
			}
		}
	}

	public func setChecklistItem(_ id: String, item raw: JSONValue, remove: Bool = false, context: TodoMutationContext = TodoMutationContext()) throws -> JSONValue {
		let item = try TodoSchema.checklistItem(raw)
		let itemID = item["id"]?.stringValue ?? ""
		return try transact("checklist", input: ["id": .string(id), "item": item, "remove": .bool(remove)], context: context) { db in
			let todo = try self.editable(db, id: id, context: context)
			return Built(changes: [
				TodoChange(kind: "occurrence", id: todo["occurrenceId"]?.stringValue ?? "", fields: ["check:\(itemID)": remove ? .null : item]),
				TodoChange(kind: "todo", id: id, fields: ["check:\(itemID)": remove ? .null : Self.unchecked(item)]),
			]) { db in try self.todo(db, id: id) }
		}
	}

	public func setReminder(_ id: String, reminder raw: JSONValue, remove: Bool = false, context: TodoMutationContext = TodoMutationContext()) throws -> JSONValue {
		let reminder = try TodoSchema.reminder(raw)
		let reminderID = reminder["id"]?.stringValue ?? ""
		return try transact("reminder", input: ["id": .string(id), "reminder": reminder, "remove": .bool(remove)], context: context) { db in
			let todo = try self.editable(db, id: id, context: context)
			let usesOffset = !(reminder["offsetMinutes"] ?? .null).isNull
			if !remove, usesOffset, todo["due"]?["time"]?.stringValue == nil {
				throw TodoError("time_required", "A date-only todo needs an explicit reminder time.")
			}
			var template: JSONValue = .null
			if !remove, usesOffset, case var .object(object) = reminder {
				object["snoozedUntil"] = .null
				template = .object(object)
			}
			return Built(changes: [
				TodoChange(kind: "occurrence", id: todo["occurrenceId"]?.stringValue ?? "", fields: ["reminder:\(reminderID)": remove ? .null : reminder]),
				TodoChange(kind: "todo", id: id, fields: ["reminder:\(reminderID)": template]),
			]) { db in try self.todo(db, id: id) }
		}
	}

	// MARK: Lists & tags

	public func organization(_ kind: String) throws -> [JSONValue] {
		guard kind == "list" || kind == "tag" else { throw TodoError.invalid("Unknown organization kind.") }
		let rows = try store.writer.read { db in try self.store.entities(db, kind: kind) }
			.filter { $0.values["deleted"] != true && $0.values["name"]?.stringValue != nil }
			.map { record -> JSONValue in
				var object = record.values
				object["id"] = .string(record.id)
				return .object(object)
			}
		return kind == "list" ? [["id": "inbox", "name": "Inbox"]] + rows : rows
	}

	public func saveOrganization(_ kind: String, id: String?, name: String?, remove: Bool, context: TodoMutationContext = TodoMutationContext()) throws -> JSONValue {
		guard kind == "list" || kind == "tag" else { throw TodoError.invalid("Unknown organization kind.") }
		if let id, !TodoSchema.isID(id) { throw TodoError.invalid("Invalid id.") }
		if id == "inbox" { throw TodoError("protected", "Inbox cannot be renamed or removed.") }
		let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines)
		if let trimmed, !(1 ... 200).contains(trimmed.count) { throw TodoError.invalid("Names are 1–200 characters.") }
		if (trimmed ?? "").isEmpty, !remove { throw TodoError("name_required", "A name is required.") }
		var input: [String: JSONValue] = ["remove": .bool(remove)]
		if let id { input["id"] = .string(id) }
		if let trimmed, !trimmed.isEmpty { input["name"] = .string(trimmed) }

		return try transact("save_\(kind)", input: .object(input), context: context) { db in
			let targetID = id ?? UUID().uuidString.lowercased()
			if id != nil { _ = try self.requireEntity(db, kind: kind, id: targetID) }
			var fields: [String: JSONValue] = ["deleted": .bool(remove)]
			if let trimmed, !trimmed.isEmpty { fields["name"] = .string(trimmed) }
			return Built(changes: [TodoChange(kind: kind, id: targetID, fields: fields)]) { db in
				var object = try self.requireEntity(db, kind: kind, id: targetID).values
				object["id"] = .string(targetID)
				return .object(object)
			}
		}
	}

	// MARK: History

	func history(_ db: Database, id: String) throws -> [TodoOperation] {
		_ = try requireEntity(db, kind: "todo", id: id)
		return try store.operations(db).filter { op in
			op.changes.contains { ($0.kind == "todo" && $0.id == id) || ($0.kind == "occurrence" && $0.id.hasPrefix("\(id):")) }
		}
	}

	public func historyOperations(_ id: String) throws -> [JSONValue] {
		try store.writer.read { db in try self.history(db, id: id).map(\.json) }
	}

	static let restorableFields = Set(TodoSchema.todoFieldKeys + ["due"])

	/// Flattened field edits, newest first. Superseded values stay restorable.
	public func historyEntries(_ id: String) throws -> [JSONValue] {
		try store.writer.read { db in
			let record = try self.requireEntity(db, kind: "todo", id: id)
			let current = try self.todo(db, id: id)
			let currentOccurrence = current["occurrenceId"]?.stringValue ?? ""
			let occurrence = try self.store.entity(db, kind: "occurrence", id: currentOccurrence)
			var entries: [JSONValue] = []
			for op in try self.history(db, id: id) {
				let stamp = op.stamp
				for change in op.changes {
					let target: TodoEntity? = change.kind == "todo" ? record : (change.id == currentOccurrence ? occurrence : nil)
					for (field, value) in change.fields.sorted(by: { $0.key < $1.key }) where field != "updatedAt" {
						let isCurrent = target?.fields[field]?.stamp == stamp
						entries.append([
							"operationId": .string(op.id),
							"at": .string(op.at),
							"source": .string(op.source),
							"replica": .string(op.replica),
							"kind": .string(change.kind),
							"entityId": .string(change.id),
							"field": .string(field),
							"value": value,
							"current": .bool(isCurrent),
							"restorable": .bool(Self.restorableFields.contains(field == "anchor" ? "due" : field) && target != nil && !isCurrent),
						])
					}
				}
			}
			return entries.reversed()
		}
	}

	/// Restore a field value from a past operation on the current todo.
	public func restoreField(_ id: String, operationID: String, field: String, context: TodoMutationContext = TodoMutationContext()) throws -> JSONValue {
		let (change, kind): ([String: JSONValue], String) = try store.writer.read { db in
			let current = try self.todo(db, id: id)
			let currentOccurrence = current["occurrenceId"]?.stringValue ?? ""
			guard let op = try self.history(db, id: id).first(where: { $0.id == operationID }),
			      let change = op.changes.first(where: {
			      	$0.fields.keys.contains(field) &&
			      		(($0.kind == "todo" && $0.id == id) || ($0.kind == "occurrence" && $0.id == currentOccurrence))
			      })
			else { throw TodoError("not_found", "This historical value was not found on the current todo.", status: 404) }
			return (change.fields, change.kind)
		}
		let target = kind == "todo" && field == "anchor" ? "due" : field
		guard Self.restorableFields.contains(target) else { throw TodoError("not_restorable", "This field cannot be restored.") }
		return try update(id, [target: change[field] ?? .null, "scope": .string(kind == "todo" ? "series" : "occurrence")], context: context)
	}

	/// Clear project links after a local project deletion.
	public func unlinkProject(_ projectID: String) throws {
		let ids = try store.writer.read { db in
			try self.store.entities(db, kind: "todo").filter { record in
				record.fields["createdAt"] != nil && (try? self.todo(db, id: record.id))?["projectId"]?.stringValue == projectID
			}.map(\.id)
		}
		for todoID in ids {
			_ = try transact("unlink_project", input: ["id": .string(todoID), "projectId": .string(projectID)], context: TodoMutationContext(source: "project")) { _ in
				Built(changes: [TodoChange(kind: "todo", id: todoID, fields: ["projectId": .null, "projectLabel": .null])]) { _ in
					["id": .string(todoID)]
				}
			}
		}
	}

	// MARK: Summary & reminders

	func openTodos() throws -> [JSONValue] {
		try store.writer.read { db in
			try self.store.entities(db, kind: "todo")
				.filter { $0.fields["createdAt"] != nil }
				.map { try self.todo(db, id: $0.id) }
				.filter { $0["deleted"] != true && $0["state"]?["status"] == "open" }
				.sorted(by: Self.dueOrder)
		}
	}

	public func summary(now: Date = Date(), timezone: TimeZone = .current) throws -> JSONValue {
		let todos = try openTodos()
		let today = TodoRecurrence.localDateTime(now, timezone: timezone.identifier).date
		let overdue = todos.filter { TodoRecurrence.isOverdue(TodoDue($0["due"]), now: now) }
		let dueToday = todos.filter { $0["due"]?["date"]?.stringValue == today }
		func escape(_ text: String) -> String {
			var out = ""
			for character in text {
				if "\\[]*_`<>".contains(character) { out.append("\\") }
				out.append(character == "\n" ? " " : character)
			}
			return out
		}
		let markdown: String
		if todos.isEmpty {
			markdown = "No open todos. Create a todo in the Todos workspace or ask Toby in chat."
		} else {
			let lines = todos.prefix(20).map { todo -> String in
				let id = todo["id"]?.stringValue ?? ""
				var line = "- [\(escape(todo["title"]?.stringValue ?? ""))](toby://todos/\(id))"
				if let due = TodoDue(todo["due"]) {
					line += " · \(due.date)"
					if let time = due.time { line += " \(time) \(due.timezone)" }
				}
				return line
			}
			markdown = "\(todos.count) open · \(overdue.count) overdue · \(dueToday.count) due today\n\n\(lines.joined(separator: "\n"))"
		}
		let items: [JSONValue] = todos.prefix(50).map { todo in
			var item: [String: JSONValue] = [
				"id": todo["id"] ?? .null,
				"title": todo["title"] ?? .null,
				"detail": todo["description"] ?? "",
				"url": .string("toby://todos/\(todo["id"]?.stringValue ?? "")"),
			]
			if let due = TodoDue(todo["due"]) {
				item["timestamp"] = .string(TodoRecurrence.dueInstant(due).map(TodoRecurrence.isoString) ?? "\(due.date)T12:00:00Z")
			}
			return .object(item)
		}
		return [
			"count": .number(Double(todos.count)),
			"markdown": .string(markdown),
			"overdue": .array(Array(overdue.prefix(50))),
			"today": .array(Array(dueToday.prefix(50))),
			"items": .array(items),
			"generatedAt": .string(TodoRecurrence.isoString(now)),
		]
	}

	public var needsRestoreReview: Bool { FileManager.default.fileExists(atPath: restoreMarker.path) }

	/// Reminder fire times for open todos (definitions sync; scheduling is local).
	public func reminderSchedule(now: Date = Date()) throws -> JSONValue {
		let paused = needsRestoreReview
		var reminders: [JSONValue] = []
		if !paused {
			for todo in try openTodos() {
				let dueAt = TodoDue(todo["due"]).flatMap { $0.time != nil ? TodoRecurrence.dueInstant($0) : nil }
				for reminder in todo["reminders"]?.arrayValue ?? [] {
					var at = reminder["snoozedUntil"]?.stringValue ?? reminder["at"]?.stringValue
					if at == nil, let dueAt, let offset = reminder["offsetMinutes"]?.doubleValue {
						at = TodoRecurrence.isoString(dueAt.addingTimeInterval(-offset * 60))
					}
					guard let at else { continue }
					reminders.append([
						"todoId": todo["id"] ?? .null,
						"occurrenceId": todo["occurrenceId"] ?? .null,
						"sequence": todo["sequence"] ?? 0,
						"reminderId": reminder["id"] ?? .null,
						"title": todo["title"] ?? .null,
						"at": .string(at),
					])
				}
			}
		}
		return ["pausedForRestore": .bool(paused), "reminders": .array(reminders), "generatedAt": .string(TodoRecurrence.isoString(now))]
	}
}
