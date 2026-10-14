import Foundation

struct FlowEditorDraft: Equatable, Identifiable {
	var existingId: String?
	var name: String
	var description: String
	var icon: String
	var color: String
	var personaName: String
	var nodes: [FlowEditorNode]
	var destinations: [FlowEditorDestination]
	var result: FlowResultPointer?
	var originalPersona: FlowPersonaSpec?
	var triggers: [FlowTriggerSpec] = [.manual()]
	var projectId: String = ""
	var revision: Int?
	var invalidTriggerFields: Set<String> = []

	var id: String { existingId ?? "new" }

	var isNew: Bool { existingId == nil }

	var hasHomeActionTrigger: Bool { triggers.contains { $0.source.type == "home.action" } }

	var hasHomeRefreshTrigger: Bool { triggers.contains { $0.isHomeRefresh } }

	mutating func selectHomeRefresh() {
		triggers.removeAll { $0.source.type == "home.action" }
		if !hasHomeRefreshTrigger { triggers.append(.homeRefresh()) }
		synchronizeHomeActionDestination()
	}

	mutating func selectHomeAction() {
		triggers.removeAll { $0.isHomeRefresh }
		if !hasHomeActionTrigger { triggers.append(.homeAction()) }
		synchronizeHomeActionDestination()
	}

	mutating func synchronizeHomeActionDestination(removingHomeAction: Bool = false) {
		if hasHomeActionTrigger {
			if let index = destinations.firstIndex(where: { $0.type == "dashboard" }) {
				destinations[index].dashboardVariant = "runner"
			} else {
				var destination = FlowEditorDestination.dashboard()
				destination.dashboardVariant = "runner"
				destinations.append(destination)
			}
		} else if hasHomeRefreshTrigger {
		if let index = destinations.firstIndex(where: { $0.type == "dashboard" }) {
			destinations[index].dashboardVariant = "informational"
		} else { destinations.append(.dashboard()) }
		} else if removingHomeAction {
			for index in destinations.indices where destinations[index].type == "dashboard" {
				destinations[index].dashboardVariant = "informational"
			}
		}
	}

	/// If steps write the same bag key, only the last writer is available.
	func promptOutputs(before nodeId: String) -> [FlowPromptOutput] {
		var outputs: [FlowPromptOutput] = []
		for node in nodes.prefix(while: { $0.id != nodeId }) {
			for key in node.outputKeys {
				outputs.removeAll { $0.key == key }
				outputs.append(FlowPromptOutput(key: key, stepId: node.id, textPath: node.suggestedOutputPath(for: key, type: "string"), booleanPath: node.suggestedOutputPath(for: key, type: "boolean")))
			}
		}
		return outputs
	}

	/// A bag key no step writes yet, e.g. `answer`, `answer2`, so each new
	/// step's output stays readable after later steps run.
	func uniqueOutputKey(base: String) -> String {
		let taken = Set(nodes.flatMap(\.outputKeys))
		if !taken.contains(base) { return base }
		var suffix = 2
		while taken.contains("\(base)\(suffix)") { suffix += 1 }
		return "\(base)\(suffix)"
	}

	/// Adds a new step at the end, writing to its own output key.
	mutating func appendStep(_ node: FlowEditorNode) {
		var node = node
		if node.outputs == nil {
			let key = uniqueOutputKey(base: node.isLLM ? "answer" : "result")
			node.outputs = [key: node.isLLM ? "object" : "result"]
		}
		nodes.append(node)
	}

	mutating func adaptResultForNamedFields(nodeId: String) {
		guard let pointer = result, pointer.path == "markdown",
			let node = nodes.first(where: { $0.id == nodeId }),
			node.outputKeys.contains(pointer.from), node.outputKind == "object",
			!node.outputFields.contains(where: { $0.name == "markdown" }) else { return }
		let mapping = node.outputs?[pointer.from] ?? "object"
		if mapping == "object" { result = FlowResultPointer(from: pointer.from, path: nil) }
	}

	var outputValidationError: String? { nodes.lazy.compactMap(\.outputValidationError).first }

	static func blank() -> FlowEditorDraft {
		FlowEditorDraft(
			existingId: nil,
			name: "Untitled flow",
			description: "",
			icon: FlowIconOption.defaultSymbol,
			color: FlowColorOption.defaultId,
			personaName: "",
			nodes: [],
			destinations: [FlowEditorDestination.modal()]
		)
	}

	static func from(document: FlowDocumentPayload) -> FlowEditorDraft {
		let personaName: String
		if document.persona?.source == "named" {
			personaName = document.persona?.name ?? ""
		} else {
			personaName = ""
		}
		let destinations = (document.destinations ?? []).map(FlowEditorDestination.init(spec:))
		var draft = FlowEditorDraft(
			existingId: document.id,
			name: document.name,
			description: document.description ?? "",
			icon: FlowIconOption.resolvedSymbol(document.icon),
			color: FlowColorOption.resolvedId(document.color),
			personaName: personaName,
			nodes: document.nodes.map(FlowEditorNode.init(stored:)),
			destinations: destinations.isEmpty ? [FlowEditorDestination.modal()] : destinations,
			result: document.result,
			originalPersona: document.persona,
			triggers: document.triggers ?? [.manual()],
			projectId: document.projectId ?? "",
			revision: document.revision
		)
		if draft.destinations.contains(where: { $0.type == "dashboard" && $0.dashboardVariant == "runner" }) {
			draft.selectHomeAction()
		} else if draft.destinations.contains(where: { $0.type == "dashboard" }) {
			draft.selectHomeRefresh()
		} else { draft.synchronizeHomeActionDestination() }
		return draft
	}

	func jsonBody() -> [String: Any] {
		var normalized = self
		normalized.synchronizeHomeActionDestination()
		var body: [String: Any] = [
			"name": name.trimmingCharacters(in: .whitespacesAndNewlines),
			"triggers": triggers.map(\.jsonBody),
			"projectId": projectId,
			"icon": FlowIconOption.resolvedSymbol(icon),
			"color": FlowColorOption.resolvedId(color),
			"nodes": nodes.map { $0.jsonBody() },
			"destinations": normalized.destinations.map { $0.jsonBody() },
		]
		let trimmedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
		if !trimmedDescription.isEmpty {
			body["description"] = trimmedDescription
		}
		let trimmedPersona = personaName.trimmingCharacters(in: .whitespacesAndNewlines)
		if !trimmedPersona.isEmpty {
			body["persona"] = ["source": "named", "name": trimmedPersona]
		} else {
			body["persona"] = ["source": originalPersona?.source == "dashboard" ? "dashboard" : "default"]
		}
		// Replacing a step may remove its named output. Let the runtime infer the
		// new final result rather than submitting a pointer to a removed output.
		if let result, nodes.contains(where: { $0.outputKeys.contains(result.from) }) {
			var pointer = ["from": result.from]
			if let path = result.path { pointer["path"] = path }
			body["result"] = pointer
		}
		if let revision { body["revision"] = revision }
		return body
	}
}

struct FlowEditorOutputInput: Codable, Equatable, Sendable {
	var from: String
	var path: String?
}

struct FlowEditorOutputField: Identifiable, Equatable, Sendable {
	var id = UUID().uuidString
	var name: String
	var type: String
	var description: String = ""
}

struct FlowEditorNode: Identifiable, Equatable {
	var id: String
	var type: String
	var moduleName: String
	var toolName: String
	var userToolId: String?
	var constInputs: [String: String]
	var triggerInputs: [String: String] = [:]
	var outputInputs: [String: FlowEditorOutputInput] = [:]
	var when: FlowEditorOutputInput?
	var outputKind = "markdown"
	var outputFields: [FlowEditorOutputField] = []
	var systemPrompt: String
	var userPrompt: String
	var standardTool: String?
	var originalJSON: Data?
	var originalInputStrings: [String: String] = [:]
	/// Bag key → result path this step writes; nil uses the runtime default.
	var outputs: [String: String]?

	var isLLM: Bool { type == "llm_prompter" || type == "agent_task" }

	var outputKeys: [String] {
		if let outputs { return outputs.keys.sorted() }
		return [isLLM ? "object" : "result"]
	}

	var outputValidationError: String? {
		guard type == "llm_prompter", outputKind == "object" else { return nil }
		guard (1...32).contains(outputFields.count) else { return "Add 1–32 output fields." }
		var names = Set<String>()
		for field in outputFields {
			guard field.name.range(of: "^[A-Za-z][A-Za-z0-9_]*$", options: .regularExpression) != nil,
				!["constructor", "prototype", "__proto__"].contains(field.name) else { return "Field names must start with a letter and contain only letters, numbers, and underscores." }
			guard names.insert(field.name).inserted else { return "Each output field needs a unique name." }
		}
		return nil
	}

	func suggestedOutputPath(for key: String, type: String) -> String? {
		guard isLLM else { return nil }
		let mapping = outputs?[key] ?? "object"
		let field = outputKind == "markdown" ? (type == "string" ? "markdown" : nil) : outputFields.first(where: { $0.type == type })?.name
		guard let field else { return nil }
		if mapping == "object" { return field }
		if mapping == "." || mapping.isEmpty { return "object.\(field)" }
		return nil
	}

	static func tool(moduleName: String, toolName: String, required: [String]) -> FlowEditorNode {
		var inputs: [String: String] = [:]
		for field in required {
			inputs[field] = ""
		}
		return FlowEditorNode(
			id: "node-\(UUID().uuidString.prefix(8))",
			type: "tool_executor",
			moduleName: moduleName,
			toolName: toolName,
			userToolId: nil,
			constInputs: inputs,
			systemPrompt: "",
			userPrompt: ""
		)
	}

	static func llm() -> FlowEditorNode {
		FlowEditorNode(
			id: "node-\(UUID().uuidString.prefix(8))",
			type: "llm_prompter",
			moduleName: "",
			toolName: "",
			userToolId: nil,
			constInputs: [:],
			systemPrompt: "Reply with markdown only.",
			userPrompt: "Write a short update for me."
		)
	}

	static func userTool(_ tool: UserScriptTool) -> FlowEditorNode {
		FlowEditorNode(
			id: "node-\(UUID().uuidString.prefix(8))",
			type: "tool_executor",
			moduleName: "",
			toolName: "",
			userToolId: tool.id,
			constInputs: Dictionary(uniqueKeysWithValues: tool.inputNames.map { ($0, "") }),
			systemPrompt: "",
			userPrompt: ""
		)
	}

	init(stored: FlowStoredNode) {
		id = stored.id
		type = stored.type
		moduleName = stored.tool?.moduleName ?? ""
		toolName = stored.tool?.toolName ?? ""
		userToolId = stored.tool?.userToolId
		standardTool = stored.tool?.standardTool
		originalJSON = try? JSONSerialization.data(withJSONObject: stored.originalFields.mapValues(\.value), options: .sortedKeys)
		outputs = stored.originalFields["outputs"]?.value as? [String: String]
		outputKind = stored.schema?.kind ?? "markdown"
		outputFields = (stored.schema?.fields ?? [:]).sorted { $0.key < $1.key }.map { FlowEditorOutputField(name: $0.key, type: $0.value.type, description: $0.value.description ?? "") }
		if let raw = stored.originalFields["when"], let data = try? JSONSerialization.data(withJSONObject: raw.value) {
			when = try? JSONDecoder().decode(FlowEditorOutputInput.self, from: data)
		}
		var inputs: [String: String] = [:]
		if let storedInputs = stored.inputs {
			for (key, source) in storedInputs {
				if source.from == "trigger" { triggerInputs[key] = source.path ?? "" }
				else if let from = source.from { outputInputs[key] = FlowEditorOutputInput(from: from, path: source.path) }
				if let value = source.constValue {
					inputs[key] = value.editorString
				}
			}
		}
		constInputs = inputs
		originalInputStrings = inputs
		systemPrompt = stored.systemPrompt ?? ""
		userPrompt = stored.userPrompt ?? ""
	}

	init(
		id: String,
		type: String,
		moduleName: String,
		toolName: String,
		userToolId: String? = nil,
		constInputs: [String: String],
		systemPrompt: String,
		userPrompt: String
	) {
		self.id = id
		self.type = type
		self.moduleName = moduleName
		self.toolName = toolName
		self.userToolId = userToolId
		self.constInputs = constInputs
		self.systemPrompt = systemPrompt
		self.userPrompt = userPrompt
	}

	func jsonBody() -> [String: Any] {
		var body = originalJSON.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
		body["id"] = id
		body["type"] = type
		if let outputs { body["outputs"] = outputs }
		if isLLM {
			if type == "agent_task" {
				body.removeValue(forKey: "schema")
				body.removeValue(forKey: "promptHelpers")
				body["systemPrompt"] = systemPrompt
				body["userPrompt"] = userPrompt
				return body
			}
			if outputKind == "object" {
				var fields: [String: Any] = [:]
				for field in outputFields {
					var spec = ["type": field.type]
					if !field.description.isEmpty { spec["description"] = field.description }
					fields[field.name] = spec
				}
				body["schema"] = ["kind": "object", "fields": fields]
			} else { body["schema"] = ["kind": "markdown"] }
			body["systemPrompt"] = systemPrompt
			body["userPrompt"] = userPrompt
			if body["promptHelpers"] == nil, originalJSON == nil { body["promptHelpers"] = ["composePersona": true] }
			return body
		}
		if let when {
			var condition = ["from": when.from]
			if let path = when.path { condition["path"] = path }
			body["when"] = condition
		} else { body.removeValue(forKey: "when") }
		var inputs: [String: Any] = [:]
		let originalInputs = body["inputs"] as? [String: Any]
		for (key, raw) in constInputs where triggerInputs[key] == nil && outputInputs[key] == nil {
			if originalInputStrings[key] == raw, let source = originalInputs?[key] as? [String: Any], source["const"] != nil {
				inputs[key] = source
				continue
			}
			let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
			if trimmed.isEmpty { continue }
			inputs[key] = ["const": FlowEditorNode.jsonConst(trimmed)]
		}
		for (key, path) in triggerInputs { inputs[key] = ["from":"trigger", "path":path] }
		for (key, source) in outputInputs {
			var reference = ["from": source.from]
			if let path = source.path { reference["path"] = path }
			inputs[key] = reference
		}
		if let userToolId { body["tool"] = ["userToolId": userToolId] }
		else if let standardTool { body["tool"] = ["standardTool": standardTool] }
		else { body["tool"] = ["moduleName": moduleName, "toolName": toolName] }
		body.removeValue(forKey: "inputs")
		if !inputs.isEmpty {
			body["inputs"] = inputs
		}
		return body
	}

	private static func jsonConst(_ raw: String) -> Any {
		let lower = raw.lowercased()
		if lower == "true" { return true }
		if lower == "false" { return false }
		if let number = Double(raw), raw.allSatisfy({ $0.isNumber || $0 == "." || $0 == "-" }) {
			if let intVal = Int(raw) { return intVal }
			return number
		}
		return raw
	}
}

struct FlowPromptOutput: Identifiable, Equatable {
	let key: String
	let stepId: String
	var stepName: String?
	var textPath: String? = nil
	var booleanPath: String? = nil
	var id: String { key }
	var token: String { "{{json bag.\(key)}}" }
}

struct FlowEditorDestination: Identifiable, Equatable {
	var id: String
	var type: String
	var emailTo: String
	var emailSubject: String
	var slackChannel: String
	var dashboardVariant: String
	var dashboardColor: String = ""
	var dashboardRefresh: String
	var emailCc: [String]?

	static func modal() -> FlowEditorDestination {
		FlowEditorDestination(
			id: UUID().uuidString,
			type: "modal",
			emailTo: "",
			emailSubject: "",
			slackChannel: "",
			dashboardVariant: "informational",
			dashboardRefresh: "asNeeded"
		)
	}

	static func email() -> FlowEditorDestination {
		FlowEditorDestination(
			id: UUID().uuidString,
			type: "email",
			emailTo: "",
			emailSubject: "",
			slackChannel: "",
			dashboardVariant: "informational",
			dashboardRefresh: "asNeeded"
		)
	}

	static func slack() -> FlowEditorDestination {
		FlowEditorDestination(
			id: UUID().uuidString,
			type: "slack",
			emailTo: "",
			emailSubject: "",
			slackChannel: "",
			dashboardVariant: "informational",
			dashboardRefresh: "asNeeded"
		)
	}

	static func dashboard() -> FlowEditorDestination {
		FlowEditorDestination(
			id: UUID().uuidString,
			type: "dashboard",
			emailTo: "",
			emailSubject: "",
			slackChannel: "",
			dashboardVariant: "informational",
			dashboardRefresh: "asNeeded"
		)
	}

	init(spec: FlowDestinationSpec) {
		id = UUID().uuidString
		type = spec.type
		emailTo = (spec.to ?? []).joined(separator: ", ")
		emailSubject = spec.subject ?? ""
		emailCc = spec.cc
		slackChannel = spec.channel ?? ""
		dashboardVariant = spec.variant ?? "informational"
		dashboardColor = DashboardBlockColor.validated(spec.color) ?? ""
		dashboardRefresh = spec.refresh == "manual" ? "manual" : "asNeeded"
	}

	init(
		id: String,
		type: String,
		emailTo: String,
		emailSubject: String,
		slackChannel: String,
		dashboardVariant: String,
		dashboardRefresh: String = "asNeeded"
	) {
		self.id = id
		self.type = type
		self.emailTo = emailTo
		self.emailSubject = emailSubject
		self.slackChannel = slackChannel
		self.dashboardVariant = dashboardVariant
		self.dashboardRefresh = dashboardRefresh
	}

	var label: String {
		switch type {
		case "modal": return "Show a result window"
		case "email": return "Send email"
		case "slack": return "Post to Slack"
		case "dashboard": return "Dashboard"
		default: return type.capitalized
		}
	}

	func jsonBody() -> [String: Any] {
		switch type {
		case "email":
			let recipients = emailTo
				.split(separator: ",")
				.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
				.filter { !$0.isEmpty }
			var body: [String: Any] = [
				"type": "email",
				"to": recipients,
				"subject": emailSubject,
			]
			if let emailCc { body["cc"] = emailCc }
			return body
		case "slack":
			return ["type": "slack", "channel": slackChannel]
		case "dashboard":
			var body: [String: Any] = [
				"type": "dashboard",
				"variant": dashboardVariant == "runner" ? "runner" : "informational",
			]
			if let color = DashboardBlockColor.validated(dashboardColor) {
				body["color"] = color
			}
			if dashboardVariant != "runner" {
				body["refresh"] = dashboardRefresh == "manual" ? "manual" : "asNeeded"
			}
			return body
		default:
			return ["type": "modal"]
		}
	}
}

extension AnyCodable {
	var editorString: String {
		if let s = value as? String { return s }
		if let b = value as? Bool { return b ? "true" : "false" }
		if let i = value as? Int { return String(i) }
		if let d = value as? Double { return String(d) }
		return displayString
	}
}
