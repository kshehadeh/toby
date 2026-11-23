import Foundation
import GRDB
import TobyAI

/// A validation failure with every issue (the daemon's `UserFlowValidationError`).
public struct FlowValidationError: Error, LocalizedError, Sendable, Equatable {
	public var issues: [String]
	public init(_ issues: [String]) { self.issues = issues }
	public var errorDescription: String? { issues.joined(separator: "; ") }
}

/// Flow documents are stored as JSON (`flows.definition_json`); this enum
/// ports parsing, trigger normalization, validation, and persistence
/// (`parse-user-flow.ts`, `triggers/types.ts`, `validate-user-flow.ts`,
/// `home-action.ts`, `definition-store.ts`).
public enum FlowDocuments {
	public static let icons: Set<String> = [
		"arrow.triangle.branch", "bolt.fill", "sparkles", "wand.and.stars", "play.circle", "gearshape", "clock", "calendar", "checklist", "envelope",
		"tray", "paperplane", "bell", "flag", "bookmark", "star", "heart", "house", "briefcase", "folder", "doc.text", "person", "bubble.left", "link",
		"globe", "laptopcomputer", "moon", "sun.max", "flame", "leaf", "cart", "bag", "hammer", "wrench.and.screwdriver",
	]
	public static let colors: Set<String> = ["teal", "blue", "green", "orange", "purple", "pink", "red", "gray"]
	static let reserved: Set<String> = ["trigger", "automation", "__proto__", "constructor", "prototype"]
	static let nativeTypes: Set<String> = ["macos.userReturned", "macos.didWake", "macos.fileChanges"]

	static func nonEmpty(_ value: JSONValue?) -> String? { value?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty }

	// MARK: Triggers

	public static func manualTrigger(id: String = "manual", name: String = "Manually", source: JSONValue = ["type": "manual"]) -> JSONValue {
		["id": .string(id), "name": .string(name), "enabled": true, "source": source, "conditions": ["timezone": .string(TimeZone.current.identifier)],
		 "policy": ["cooldownSeconds": 0, "oncePerDay": false], "inputs": [:], "eventInputMappings": [:], "notifyOnCompletion": false]
	}

	/// Parse and default triggers (missing → one manual trigger).
	public static func triggers(_ raw: JSONValue?) throws -> [JSONValue] {
		guard let raw, !raw.isNull else { return [manualTrigger()] }
		guard let list = raw.arrayValue, list.count <= 32 else { throw FlowValidationError(["Triggers must be a list of at most 32"]) }
		var ids = Set<String>()
		let parsed = try list.map { item -> JSONValue in
			guard let id = item["id"]?.stringValue, id.wholeMatch(of: /[a-zA-Z0-9_-]{1,100}/) != nil else { throw FlowValidationError(["Trigger ids use letters, numbers, - and _"]) }
			guard ids.insert(id).inserted else { throw FlowValidationError(["Trigger IDs must be unique within a flow"]) }
			guard let name = nonEmpty(item["name"]) else { throw FlowValidationError(["Trigger \(id) needs a name"]) }
			guard let source = item["source"], let type = source["type"]?.stringValue else { throw FlowValidationError(["Trigger \(id) needs a source"]) }
			var normalizedSource = source.objectValue ?? [:]
			switch type {
			case "manual", "home.action", "dashboard.refresh", "macos.didWake":
				break
			case "schedule":
				guard let cron = source["cron"]?.stringValue, CronExpression(cron) != nil else { throw FlowValidationError(["Invalid cron expression"]) }
				let missed = source["missedRuns"]?.stringValue ?? "latest"
				guard missed == "skip" || missed == "latest" else { throw FlowValidationError(["missedRuns must be skip or latest"]) }
				normalizedSource["missedRuns"] = .string(missed)
			case "macos.userReturned":
				let idle = source["minimumIdleSeconds"]?.intValue ?? 1800
				guard (10 ... 604_800).contains(idle) else { throw FlowValidationError(["minimumIdleSeconds must be 10–604800"]) }
				normalizedSource["minimumIdleSeconds"] = .number(Double(idle))
			case "macos.fileChanges":
				guard let folder = source["folder"]?.stringValue, folder.hasPrefix("/") else { throw FlowValidationError(["Select an absolute folder path"]) }
				normalizedSource["recursive"] = source["recursive"] ?? false
				normalizedSource["extensions"] = source["extensions"] ?? []
				normalizedSource["excludedPaths"] = source["excludedPaths"] ?? []
				normalizedSource["kinds"] = source["kinds"] ?? ["new"]
				let settling = source["settlingSeconds"]?.intValue ?? 5
				guard (2 ... 60).contains(settling) else { throw FlowValidationError(["settlingSeconds must be 2–60"]) }
				normalizedSource["settlingSeconds"] = .number(Double(settling))
				normalizedSource["allowLargeFolder"] = source["allowLargeFolder"] ?? false
				_ = folder
			default:
				throw FlowValidationError(["Unsupported trigger source \"\(type)\""])
			}
			var conditions = item["conditions"]?.objectValue ?? [:]
			let timezone = conditions["timezone"]?.stringValue ?? TimeZone.current.identifier
			guard TimeZone(identifier: timezone) != nil else { throw FlowValidationError(["Invalid timezone"]) }
			conditions["timezone"] = .string(timezone)
			if let window = conditions["timeWindow"], !window.isNull {
				guard let start = window["start"]?.stringValue, let end = window["end"]?.stringValue,
				      start.wholeMatch(of: /([01]\d|2[0-3]):[0-5]\d/) != nil, end.wholeMatch(of: /([01]\d|2[0-3]):[0-5]\d/) != nil, start != end else {
					throw FlowValidationError(["Time window must have different HH:MM start and end"])
				}
			}
			var policy = item["policy"]?.objectValue ?? [:]
			policy["cooldownSeconds"] = .number(Double(policy["cooldownSeconds"]?.intValue ?? 300))
			policy["oncePerDay"] = policy["oncePerDay"] ?? false
			let inputs = item["inputs"]?.objectValue ?? [:]
			let mappings = item["eventInputMappings"]?.objectValue ?? [:]
			guard !inputs.keys.contains(where: reserved.contains), !mappings.keys.contains(where: reserved.contains) else { throw FlowValidationError(["Reserved trigger input"]) }
			for path in mappings.values.compactMap(\.stringValue) {
				if (path == "payload.idleSeconds" && type != "macos.userReturned") || ((path == "payload.folder" || path == "payload.changes") && type != "macos.fileChanges") {
					throw FlowValidationError(["Trigger has no \(path) field"])
				}
			}
			return [
				"id": .string(id), "name": .string(name), "enabled": item["enabled"] ?? false, "source": .object(normalizedSource),
				"conditions": .object(conditions), "policy": .object(policy), "inputs": .object(inputs), "eventInputMappings": .object(mappings),
				"notifyOnCompletion": item["notifyOnCompletion"] ?? false,
			]
		}
		return parsed
	}

	/// Keep Home Screen Action triggers and the dashboard "runner" destination in step.
	static func normalizeHomeAction(_ document: [String: JSONValue]) throws -> [String: JSONValue] {
		var out = document
		var triggers = try triggers(document["triggers"])
		var destinations = document["destinations"]?.arrayValue ?? []
		let homeIndex = destinations.firstIndex { $0["type"] == "dashboard" }
		let hasHome = triggers.contains { $0["source"]?["type"] == "home.action" }
		let home = homeIndex.map { destinations[$0] }
		if hasHome {
			var destination: [String: JSONValue] = ["type": "dashboard", "variant": "runner"]
			if let color = home?["color"]?.stringValue { destination["color"] = .string(color) }
			if let homeIndex { destinations[homeIndex] = .object(destination) } else { destinations.append(.object(destination)) }
		} else if home?["variant"] == "runner" {
			var id = "home-action"
			var suffix = 2
			while triggers.contains(where: { $0["id"]?.stringValue == id }) { id = "home-action-\(suffix)"; suffix += 1 }
			triggers.append(manualTrigger(id: id, name: "Home Screen Action", source: ["type": "home.action"]))
		}
		out["triggers"] = .array(try Self.triggers(.array(triggers)))
		if document["destinations"] != nil || hasHome { out["destinations"] = .array(destinations) }
		return out
	}

	// MARK: Parse (request body → document)

	static func toolRef(_ raw: JSONValue?) -> JSONValue? {
		guard let raw, raw.objectValue != nil else { return nil }
		if let core = nonEmpty(raw["coreTool"]) { return ["coreTool": .string(core)] }
		if let standard = nonEmpty(raw["standardTool"]) { return ["standardTool": .string(standard)] }
		if let module = nonEmpty(raw["moduleName"]), let tool = nonEmpty(raw["toolName"]) { return ["moduleName": .string(module), "toolName": .string(tool)] }
		return nil
	}

	static func inputs(_ raw: JSONValue?) -> JSONValue? {
		var out: [String: JSONValue] = [:]
		for (key, source) in raw?.objectValue ?? [:] {
			guard let object = source.objectValue else { continue }
			if let constant = object["const"] { out[key] = ["const": constant]; continue }
			if let from = object["from"]?.stringValue {
				var entry: [String: JSONValue] = ["from": .string(from)]
				if let path = object["path"]?.stringValue { entry["path"] = .string(path) }
				out[key] = .object(entry)
			}
		}
		return out.isEmpty ? nil : .object(out)
	}

	static func outputs(_ raw: JSONValue?) -> JSONValue? {
		let out = (raw?.objectValue ?? [:]).compactMapValues { $0.stringValue.map(JSONValue.string) }
		return out.isEmpty ? nil : .object(out)
	}

	/// The node result shape for a schema spec (markdown or flat fields).
	public static func schema(_ spec: JSONValue) throws -> JSONSchema {
		if spec["kind"] == "markdown" { return .object(["markdown": .string(description: "User-facing markdown only — no chain-of-thought")]) }
		guard spec["kind"] == "object", let fields = spec["fields"]?.objectValue else { throw FlowValidationError(["Structured output needs named fields"]) }
		guard (1 ... 32).contains(fields.count) else { throw FlowValidationError(["Structured output needs 1–32 fields"]) }
		var properties: [String: JSONSchema] = [:]
		for (name, field) in fields {
			guard name.wholeMatch(of: /[A-Za-z][A-Za-z0-9_]*/) != nil, !reserved.contains(name) else { throw FlowValidationError(["Invalid structured output field \"\(name)\""]) }
			let description = field["description"]?.stringValue
			switch field["type"]?.stringValue {
			case "string": properties[name] = .string(description: description)
			case "boolean": properties[name] = .boolean(description: description)
			case "number": properties[name] = .number(description: description)
			default: throw FlowValidationError(["Unsupported type for output field \"\(name)\""])
			}
		}
		let names = properties.keys.sorted()
		return JSONSchema([
			"type": "object", "properties": .object(properties.mapValues(\.value)),
			"required": .array(names.map(JSONValue.string)), "additionalProperties": false,
		])
	}

	static func node(_ raw: JSONValue, index: Int) throws -> JSONValue {
		let invalid = FlowValidationError(["Node \(index + 1) is invalid; every step needs an id, supported type, and valid tool reference for tool steps"])
		guard let id = nonEmpty(raw["id"]).map({ _ in raw["id"]!.stringValue! }) else { throw invalid }
		var node: [String: JSONValue] = ["id": .string(id)]
		if let value = inputs(raw["inputs"]) { node["inputs"] = value }
		if let value = outputs(raw["outputs"]) { node["outputs"] = value }
		switch raw["type"]?.stringValue {
		case "tool_executor":
			guard let tool = toolRef(raw["tool"]) else { throw invalid }
			node["type"] = "tool_executor"
			node["tool"] = tool
			if let when = raw["when"], !when.isNull {
				guard let from = nonEmpty(when["from"]), when["const"] == nil, when["path"] == nil || when["path"]?.stringValue != nil else {
					throw FlowValidationError(["Action condition needs an output reference with an optional field path"])
				}
				var condition: [String: JSONValue] = ["from": .string(from)]
				if let path = when["path"]?.stringValue { condition["path"] = .string(path) }
				node["when"] = .object(condition)
			}
		case "agent_task":
			guard raw["when"] == nil else { throw FlowValidationError(["Conditions are supported only on tool actions"]) }
			guard let prompt = raw["userPrompt"]?.stringValue, !prompt.trimmingCharacters(in: .whitespaces).isEmpty else { throw invalid }
			node["type"] = "agent_task"
			node["systemPrompt"] = .string(raw["systemPrompt"]?.stringValue ?? "")
			node["userPrompt"] = .string(prompt)
		case "llm_prompter":
			guard raw["when"] == nil else { throw FlowValidationError(["Conditions are supported only on tool actions"]) }
			let spec = raw["schema"] ?? ["kind": "markdown"]
			_ = try schema(spec)
			node["type"] = "llm_prompter"
			node["schema"] = spec
			node["systemPrompt"] = .string(raw["systemPrompt"]?.stringValue ?? "")
			node["userPrompt"] = .string(raw["userPrompt"]?.stringValue ?? "")
			for key in ["schemaName", "schemaDescription"] { if let value = raw[key]?.stringValue { node[key] = .string(value) } }
			for key in ["temperature", "maxOutputTokens", "timeoutMs"] { if let value = raw[key], value.doubleValue != nil { node[key] = value } }
			if let helpers = raw["promptHelpers"]?.objectValue {
				node["promptHelpers"] = .object(helpers.filter { ["composePersona", "appendSkillsCatalog", "appendCurrentDateTime"].contains($0.key) && $0.value.boolValue != nil })
			}
		default:
			throw invalid
		}
		return .object(node)
	}

	/// A request body → document (before validation).
	public static func parse(_ body: JSONValue, id: String) throws -> [String: JSONValue] {
		let nodes = try (body["nodes"]?.arrayValue ?? []).enumerated().map { try node($0.element, index: $0.offset) }
		var document: [String: JSONValue] = ["id": .string(id), "name": .string(nonEmpty(body["name"]) ?? "Untitled flow"), "nodes": .array(nodes), "triggers": .array(try triggers(body["triggers"]))]
		if let description = body["description"]?.stringValue { document["description"] = .string(description) }
		if let icon = nonEmpty(body["icon"]) { document["icon"] = .string(icon) }
		if let color = nonEmpty(body["color"]) { document["color"] = .string(color) }
		if let persona = body["persona"], let source = persona["source"]?.stringValue {
			if source == "named", let name = persona["name"]?.stringValue { document["persona"] = ["source": "named", "name": .string(name)] } else if ["dashboard", "default"].contains(source) {
				document["persona"] = ["source": .string(source)]
			}
		}
		if let revision = body["revision"], revision.doubleValue != nil { document["revision"] = revision }
		if let project = nonEmpty(body["projectId"]) { document["projectId"] = .string(project) }
		if let result = body["result"], let from = result["from"]?.stringValue {
			var pointer: [String: JSONValue] = ["from": .string(from)]
			if let path = result["path"]?.stringValue { pointer["path"] = .string(path) }
			document["result"] = .object(pointer)
		}
		if let destinations = body["destinations"]?.arrayValue { document["destinations"] = .array(destinations.filter { $0.objectValue != nil }) }
		return document
	}

	// MARK: Validate

	/// Catalog entry used to validate tool steps.
	public struct CatalogTool: Sendable {
		public var coreTool: String?
		public var moduleName: String
		public var toolName: String
		public var displayName: String
		public var description: String
		public var readOnly: Bool
		public var standardTool: String?
		public var inputSchema: JSONValue

		var json: JSONValue {
			var out: [String: JSONValue] = ["moduleName": .string(moduleName), "toolName": .string(toolName), "displayName": .string(displayName),
			                                "description": .string(description), "readOnly": .bool(readOnly), "inputSchema": inputSchema]
			if let coreTool { out["coreTool"] = .string(coreTool) }
			if let standardTool { out["standardTool"] = .string(standardTool) }
			return .object(out)
		}
	}

	static func resolve(_ tool: JSONValue, in tools: [CatalogTool]) -> CatalogTool? {
		if let core = tool["coreTool"]?.stringValue { return tools.first { $0.coreTool == core } }
		if let standard = tool["standardTool"]?.stringValue { return tools.first { $0.standardTool == standard } }
		guard let module = tool["moduleName"]?.stringValue, let name = tool["toolName"]?.stringValue else { return nil }
		return tools.first { $0.moduleName == module && $0.toolName == name }
	}

	static func safePath(_ path: JSONValue?) -> Bool {
		guard let path = path?.stringValue else { return path == nil }
		return !path.split(separator: ".").contains { ["__proto__", "constructor", "prototype"].contains(String($0)) }
	}

	static func isConst(_ source: JSONValue) -> Bool { source["const"] != nil && source["from"] == nil }
	static func isEvent(_ source: JSONValue) -> Bool { source["const"] == nil && source["from"] == "trigger" && safePath(source["path"]) }
	static func isOutput(_ source: JSONValue, _ outputs: Set<String>) -> Bool {
		source["const"] == nil && source["from"]?.stringValue.map(outputs.contains) == true && safePath(source["path"])
	}

	static func present(_ value: JSONValue?) -> Bool {
		guard let value, !value.isNull else { return false }
		if let text = value.stringValue { return !text.trimmingCharacters(in: .whitespaces).isEmpty }
		if let list = value.arrayValue { return !list.isEmpty }
		return true
	}

	static func defaultOutputKeys(_ node: JSONValue) -> [String] {
		node["outputs"]?.objectValue.map { Array($0.keys) } ?? [node["type"] == "tool_executor" ? "result" : "object"]
	}

	/// Validate and normalize a user document against the tool catalog.
	public static func validate(_ document: [String: JSONValue], tools: [CatalogTool], connected: Set<String>) throws -> [String: JSONValue] {
		var issues: [String] = []
		if (try? triggers(document["triggers"]))?.contains(where: { $0["source"]?["type"] == "dashboard.refresh" }) == true {
			issues.append("The Home refresh trigger was removed along with Home cards. Remove it, or use a Home Screen Action or a schedule.")
		}
		let id = nonEmpty(document["id"]) ?? ""
		let name = nonEmpty(document["name"]) ?? ""
		if id.isEmpty { issues.append("Flow must have an id") } else if id.hasPrefix("dashboard.") { issues.append("Id \"\(id)\" is reserved for built-in flows") }
		if name.isEmpty { issues.append("Flow must have a name") }
		if let icon = nonEmpty(document["icon"]), !icons.contains(icon) { issues.append("Icon \"\(icon)\" is not a supported flow icon") }
		if let color = nonEmpty(document["color"]), !colors.contains(color) { issues.append("Color \"\(color)\" is not a supported flow color") }
		let nodes = document["nodes"]?.arrayValue ?? []
		if nodes.isEmpty { issues.append("Flow must have at least one node") }
		var ids = Set<String>()
		var available = Set<String>()
		for (index, node) in nodes.enumerated() {
			guard let nodeID = nonEmpty(node["id"]) else { issues.append("Node \(index + 1) has an empty id"); continue }
			if !ids.insert(nodeID).inserted { issues.append("Duplicate node id \"\(nodeID)\"") }
			if (node["outputs"]?.objectValue ?? [:]).keys.contains(where: reserved.contains) { issues.append("Steps cannot overwrite reserved context") }
			switch node["type"]?.stringValue {
			case "tool_executor":
				if let when = node["when"], !isOutput(when, available), !isEvent(when) {
					issues.append("Node \"\(nodeID)\" condition must reference a previous step output or trigger context using a safe field path")
				}
				let inputs = node["inputs"]?.objectValue ?? [:]
				for (inputName, source) in inputs where !isConst(source) && !isEvent(source) && !isOutput(source, available) {
					issues.append("Node \"\(nodeID)\" input \"\(inputName)\" must be a constant, a trigger context reference, or a previous step output")
				}
				guard let tool = node["tool"], let catalog = resolve(tool, in: tools) else {
					let tool = node["tool"]
					let label = tool?["coreTool"]?.stringValue ?? tool?["standardTool"]?.stringValue ?? "\(tool?["moduleName"]?.stringValue ?? "").\(tool?["toolName"]?.stringValue ?? "")"
					issues.append("Node \"\(nodeID)\" references unknown tool \"\(label)\"")
					break
				}
				for field in (catalog.inputSchema["required"]?.arrayValue ?? []).compactMap(\.stringValue) {
					let source = inputs[field]
					if source == nil || (!isEvent(source!) && !isOutput(source!, available) && (!isConst(source!) || !present(source!["const"]))) {
						issues.append("Node \"\(nodeID)\" is missing required input \"\(field)\" for \(catalog.moduleName).\(catalog.toolName)")
					}
				}
			case "agent_task":
				if (node["userPrompt"]?.stringValue ?? "").trimmingCharacters(in: .whitespaces).isEmpty { issues.append("Agent Task needs a prompt") }
			case "llm_prompter":
				do { _ = try schema(node["schema"] ?? ["kind": "markdown"]) } catch { issues.append("LLM Prompter node \"\(nodeID)\": \((error as? FlowValidationError)?.issues.first ?? "Invalid output schema")") }
				if (node["systemPrompt"]?.stringValue ?? "").trimmingCharacters(in: .whitespaces).isEmpty, (node["userPrompt"]?.stringValue ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
					issues.append("LLM Prompter node \"\(nodeID)\" needs a system or user prompt")
				}
			default:
				issues.append("Node \"\(nodeID)\" has unsupported type \"\(node["type"]?.stringValue ?? "")\"")
			}
			available.formUnion(defaultOutputKeys(node))
		}
		var destinations: [JSONValue] = []
		for (index, raw) in (document["destinations"]?.arrayValue ?? [["type": "modal"]]).enumerated() {
			let label = "Destination \(index + 1)"
			switch raw["type"]?.stringValue {
			case "modal": destinations.append(["type": "modal"])
			case "email":
				let to = (raw["to"]?.arrayValue ?? []).compactMap(\.stringValue)
				let cc = (raw["cc"]?.arrayValue ?? []).compactMap(\.stringValue)
				var destination: [String: JSONValue] = ["type": "email", "to": .array(to.map(JSONValue.string)), "subject": .string(raw["subject"]?.stringValue ?? "")]
				if !cc.isEmpty { destination["cc"] = .array(cc.map(JSONValue.string)) }
				if !connected.contains("email") { issues.append("\(label): Email is not connected") }
				if to.isEmpty || to.contains(where: { $0.trimmingCharacters(in: .whitespaces).isEmpty }) { issues.append("\(label): Email needs at least one recipient") }
				if (raw["subject"]?.stringValue ?? "").trimmingCharacters(in: .whitespaces).isEmpty { issues.append("\(label): Email needs a subject") }
				destinations.append(.object(destination))
			case "slack":
				if !connected.contains("slack") { issues.append("\(label): Slack is not connected") }
				if (raw["channel"]?.stringValue ?? "").trimmingCharacters(in: .whitespaces).isEmpty { issues.append("\(label): Slack needs a channel") }
				destinations.append(["type": "slack", "channel": .string(raw["channel"]?.stringValue ?? "")])
			case "dashboard":
				if raw["variant"] == "informational" { issues.append("\(label): Home cards were removed. Use a Home Screen Action (Actions sidebar) or another destination."); continue }
				guard raw["variant"] == "runner" else { issues.append("\(label): Dashboard needs variant \"runner\""); continue }
				if let color = raw["color"], !(color.stringValue.map { $0 == "neutral" || colors.contains($0) } ?? false) {
					issues.append("\(label): Dashboard color must be neutral or a supported palette color")
					continue
				}
				var destination: [String: JSONValue] = ["type": "dashboard", "variant": "runner"]
				if let color = raw["color"] { destination["color"] = color }
				destinations.append(.object(destination))
			case let type?:
				issues.append("\(label): Unknown destination type \"\(type)\"")
			case nil:
				issues.append("\(label) is invalid")
			}
		}
		if destinations.isEmpty, issues.isEmpty { destinations.append(["type": "modal"]) }
		if destinations.filter({ $0["type"] == "dashboard" }).count > 1 { issues.append("A flow can have only one Dashboard destination") }
		if let result = document["result"] {
			let from = (result["from"]?.stringValue ?? "").trimmingCharacters(in: .whitespaces)
			let keys = Set(nodes.flatMap(defaultOutputKeys))
			if from.isEmpty { issues.append("Result pointer needs a bag key") } else if !keys.contains(from) {
				issues.append("Result references unknown output \"\(from)\". Use an output bag key, not a step id. Available outputs: \(keys.sorted().joined(separator: ", "))")
			}
		}
		guard issues.isEmpty else { throw FlowValidationError(issues) }
		var out = document
		out["id"] = .string(id)
		out["name"] = .string(name)
		out["destinations"] = .array(destinations)
		return try normalizeHomeAction(out)
	}

	// MARK: Store (`flows` table)

	public struct Record: Sendable {
		public var id: String
		public var name: String
		public var description: String?
		public var builtin: Bool
		public var document: [String: JSONValue]
		public var createdAt: String
		public var updatedAt: String
	}

	static func record(_ row: Row) -> Record? {
		guard let raw = row["definition_json"] as String?, var document = (try? JSONDecoder().decode(JSONValue.self, from: Data(raw.utf8)))?.objectValue else { return nil }
		let id: String = row["id"]
		let name: String = row["name"]
		document["id"] = .string(id)
		document["name"] = .string(name.isEmpty ? (document["name"]?.stringValue ?? id) : name)
		if let description = row["description"] as String? { document["description"] = .string(description) }
		return Record(id: id, name: name, description: row["description"], builtin: (row["builtin"] as Int?) == 1, document: document, createdAt: row["created_at"], updatedAt: row["updated_at"])
	}

	public static func load(_ db: Database, _ id: String) throws -> Record? {
		try Row.fetchOne(db, sql: "SELECT * FROM flows WHERE id = ?", arguments: [id.trimmingCharacters(in: .whitespaces)]).flatMap(record)
	}

	public static func list(_ db: Database) throws -> [Record] {
		try Row.fetchAll(db, sql: "SELECT * FROM flows ORDER BY name ASC").compactMap(record)
	}

	/// Save a user flow; bumps `revision` and refuses stale edits.
	@discardableResult
	public static func save(_ db: Database, _ document: [String: JSONValue]) throws -> Record {
		guard let id = document["id"]?.stringValue else { throw FlowValidationError(["Flow document must have a non-empty id"]) }
		let existing = try load(db, id)
		if existing?.builtin == true { throw FlowValidationError(["Cannot overwrite built-in flow \"\(id)\""]) }
		let current = existing?.document["revision"]?.intValue ?? 0
		if existing != nil, let revision = document["revision"]?.intValue, revision != current { throw FlowValidationError(["Flow changed; reload before saving"]) }
		var doc = try normalizeHomeAction(document)
		doc["revision"] = .number(Double(current + 1))
		let ts = TodoRecurrence.isoString(Date())
		try db.execute(sql: """
		INSERT INTO flows (id, name, description, persona_json, definition_json, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, persona_json = excluded.persona_json,
		  definition_json = excluded.definition_json, builtin = 0, updated_at = excluded.updated_at
		""", arguments: [id, doc["name"]?.stringValue ?? id, doc["description"]?.stringValue, doc["persona"]?.jsonString(), JSONValue.object(doc).jsonString(), existing?.createdAt ?? ts, ts])
		return try load(db, id)!
	}

	public static func delete(_ db: Database, _ id: String) throws -> Bool {
		guard let existing = try load(db, id) else { return false }
		if existing.builtin { throw FlowValidationError(["Cannot delete built-in flow \"\(id)\""]) }
		try db.execute(sql: "DELETE FROM flows WHERE id = ?", arguments: [id])
		return db.changesCount > 0
	}
}

extension FlowDocuments {
	/// Custom flows shown as Home actions (port of `dashboard/flow-blocks.ts`).
	public static func dashboardBlocks(_ db: Database) throws -> JSONValue {
		var blocks: [(String, JSONValue)] = []
		for record in try list(db) where !record.builtin {
			let destinations = record.document["destinations"]?.arrayValue ?? []
			guard let dest = destinations.first(where: { $0["type"] == "dashboard" }), dest["variant"] == "runner" else { continue }
			let triggers = record.document["triggers"]?.arrayValue ?? []
			guard triggers.contains(where: { $0["enabled"] == true && $0["source"]?["type"] == "home.action" }) else { continue }
			let last = try Row.fetchOne(db, sql: "SELECT started_at, completed_at FROM flow_runs WHERE flow_name = ? AND status = 'success' ORDER BY COALESCE(completed_at, started_at) DESC LIMIT 1", arguments: [record.id])
				.map { (($0["completed_at"] as String?) ?? ($0["started_at"] as String?)) }
			func optional(_ value: JSONValue?) -> JSONValue { value?.stringValue.map(JSONValue.string) ?? .null }
			blocks.append((record.name.lowercased(), [
				"id": .string(record.id), "flowId": .string(record.id), "title": .string(record.name),
				"description": record.description.map(JSONValue.string) ?? .null, "icon": optional(record.document["icon"]),
				"color": optional(record.document["color"]), "dashboardColor": optional(dest["color"]), "variant": "runner",
				"lastRanAt": (last ?? nil).map(JSONValue.string) ?? .null,
				"showsResultSheet": .bool(destinations.contains { $0["type"] == "modal" }),
			]))
		}
		return ["blocks": .array(blocks.sorted { $0.0 < $1.0 }.map(\.1))]
	}
}
