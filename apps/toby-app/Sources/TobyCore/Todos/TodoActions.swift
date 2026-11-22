import Foundation
import TobyAI

/// Named todo actions (port of `executeCoreTool("todos.<action>")`). Used by
/// the UI backend, chat tools, and flows. Inputs/outputs match the daemon API.
public struct TodoActions: Sendable {
	public let service: TodoService

	public init(service: TodoService) {
		self.service = service
	}

	public static let readOnly: Set<String> = ["list", "get", "lists", "tags", "history", "summary"]

	/// Execute `action` with a JSON input. Envelope fields `idempotencyKey`,
	/// `expectedRevision`, and `dryRun` are lifted into the context.
	public func execute(_ action: String, input raw: JSONValue, context base: TodoMutationContext = TodoMutationContext()) throws -> JSONValue {
		var input = raw.objectValue ?? [:]
		var context = base
		if let key = input.removeValue(forKey: "idempotencyKey")?.stringValue { context.idempotencyKey = key }
		if let revision = input.removeValue(forKey: "expectedRevision")?.stringValue { context.expectedRevision = revision }
		if let dryRun = input.removeValue(forKey: "dryRun")?.boolValue { context.dryRun = context.dryRun || dryRun }
		if Self.readOnly.contains(action) {
			context.dryRun = false
		}

		func id() throws -> String { try TodoSchema.id(input["id"], "id") }
		func requireKeys(_ allowed: Set<String>) throws {
			if let extra = input.keys.first(where: { !allowed.contains($0) }) {
				throw TodoError.invalid("Unrecognized key: \(extra)")
			}
		}

		switch action {
		case "list":
			return try service.list(.object(input))
		case "get":
			try requireKeys(["id", "sequence"])
			return try service.get(try id(), sequence: try TodoSchema.int(input["sequence"], "sequence"))
		case "create":
			return try service.create(.object(input), context: context)
		case "update":
			try requireKeys(["id", "changes"])
			return try service.update(try id(), input["changes"] ?? .object([:]), context: context)
		case "complete", "skip", "reopen":
			try requireKeys(["id", "sequence", "allowIncompleteChecklist"])
			guard let sequence = try TodoSchema.int(input["sequence"], "sequence") else {
				throw TodoError.invalid("sequence is required.")
			}
			return try service.transition(
				try id(),
				action: action,
				sequence: sequence,
				allowIncompleteChecklist: try TodoSchema.bool(input["allowIncompleteChecklist"], default: false, "allowIncompleteChecklist"),
				context: context,
			)
		case "delete", "restore":
			try requireKeys(["id"])
			return try service.delete(try id(), restore: action == "restore", context: context)
		case "setTag":
			try requireKeys(["id", "tagId", "enabled"])
			guard let enabled = input["enabled"]?.boolValue else { throw TodoError.invalid("enabled is required.") }
			return try service.setTag(try id(), tagID: try TodoSchema.id(input["tagId"], "tagId"), enabled: enabled, context: context)
		case "setChecklistItem":
			try requireKeys(["id", "item", "remove"])
			return try service.setChecklistItem(
				try id(),
				item: input["item"] ?? .null,
				remove: try TodoSchema.bool(input["remove"], default: false, "remove"),
				context: context,
			)
		case "setReminder":
			try requireKeys(["id", "reminder", "remove"])
			return try service.setReminder(
				try id(),
				reminder: input["reminder"] ?? .null,
				remove: try TodoSchema.bool(input["remove"], default: false, "remove"),
				context: context,
			)
		case "lists":
			return ["lists": .array(try service.organization("list"))]
		case "tags":
			return ["tags": .array(try service.organization("tag"))]
		case "saveLists", "saveTags":
			try requireKeys(["id", "name", "remove"])
			return try service.saveOrganization(
				action == "saveLists" ? "list" : "tag",
				id: input["id"]?.stringValue,
				name: input["name"]?.stringValue,
				remove: try TodoSchema.bool(input["remove"], default: false, "remove"),
				context: context,
			)
		case "history":
			try requireKeys(["id"])
			return ["entries": .array(try service.historyEntries(try id()))]
		case "restoreField":
			try requireKeys(["id", "operationId", "field"])
			guard let field = input["field"]?.stringValue, !field.isEmpty else { throw TodoError.invalid("field is required.") }
			return try service.restoreField(try id(), operationID: try TodoSchema.id(input["operationId"], "operationId"), field: field, context: context)
		case "summary":
			return try service.summary()
		default:
			throw TodoError("unknown_tool", "Unknown built-in tool: todos.\(action)", status: 404)
		}
	}
}
