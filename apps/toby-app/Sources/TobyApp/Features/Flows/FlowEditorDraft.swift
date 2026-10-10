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

	var id: String { existingId ?? "new" }

	var isNew: Bool { existingId == nil }

	/// If steps write the same bag key, only the last writer is available.
	func promptOutputs(before nodeId: String) -> [FlowPromptOutput] {
		var outputs: [FlowPromptOutput] = []
		for node in nodes.prefix(while: { $0.id != nodeId }) {
			for key in node.outputKeys {
				outputs.removeAll { $0.key == key }
				outputs.append(FlowPromptOutput(key: key, stepId: node.id))
			}
		}
		return outputs
	}

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
		return FlowEditorDraft(
			existingId: document.id,
			name: document.name,
			description: document.description ?? "",
			icon: FlowIconOption.resolvedSymbol(document.icon),
			color: FlowColorOption.resolvedId(document.color),
			personaName: personaName,
			nodes: document.nodes.map(FlowEditorNode.init(stored:)),
			destinations: destinations.isEmpty ? [FlowEditorDestination.modal()] : destinations,
			result: document.result,
			originalPersona: document.persona
		)
	}

	func jsonBody() -> [String: Any] {
		var body: [String: Any] = [
			"name": name.trimmingCharacters(in: .whitespacesAndNewlines),
			"icon": FlowIconOption.resolvedSymbol(icon),
			"color": FlowColorOption.resolvedId(color),
			"nodes": nodes.map { $0.jsonBody() },
			"destinations": destinations.map { $0.jsonBody() },
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
		if let result {
			var pointer = ["from": result.from]
			if let path = result.path { pointer["path"] = path }
			body["result"] = pointer
		}
		return body
	}
}

struct FlowEditorNode: Identifiable, Equatable {
	var id: String
	var type: String
	var moduleName: String
	var toolName: String
	var userToolId: String?
	var constInputs: [String: String]
	var automationInputs: [String: String] = [:]
	var systemPrompt: String
	var userPrompt: String
	var standardTool: String?
	var originalJSON: Data?
	var originalInputStrings: [String: String] = [:]

	var isLLM: Bool { type == "llm_prompter" }

	var outputKeys: [String] {
		let body = originalJSON.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
		if let outputs = body?["outputs"] as? [String: String] {
			return outputs.keys.sorted()
		}
		return [isLLM ? "object" : "result"]
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
		var inputs: [String: String] = [:]
		if let storedInputs = stored.inputs {
			for (key, source) in storedInputs {
				if source.from == "automation" { automationInputs[key] = source.path ?? "" }
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
		if isLLM {
			body["schema"] = ["kind": "markdown"]
			body["systemPrompt"] = systemPrompt
			body["userPrompt"] = userPrompt
			if body["promptHelpers"] == nil { body["promptHelpers"] = ["composePersona": true] }
			return body
		}
		var inputs: [String: Any] = [:]
		let originalInputs = body["inputs"] as? [String: Any]
		for (key, raw) in constInputs where automationInputs[key] == nil {
			if originalInputStrings[key] == raw, let source = originalInputs?[key] {
				inputs[key] = source
				continue
			}
			let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
			if trimmed.isEmpty { continue }
			inputs[key] = ["const": FlowEditorNode.jsonConst(trimmed)]
		}
		for (key, path) in automationInputs { inputs[key] = ["from":"automation", "path":path] }
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
