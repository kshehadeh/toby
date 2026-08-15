import Foundation

struct FlowEditorDraft: Equatable {
	var existingId: String?
	var name: String
	var description: String
	var personaName: String
	var nodes: [FlowEditorNode]
	var destinations: [FlowEditorDestination]

	var isNew: Bool { existingId == nil }

	static func blank() -> FlowEditorDraft {
		FlowEditorDraft(
			existingId: nil,
			name: "Untitled flow",
			description: "",
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
			personaName: personaName,
			nodes: document.nodes.map(FlowEditorNode.init(stored:)),
			destinations: destinations.isEmpty ? [FlowEditorDestination.modal()] : destinations
		)
	}

	func jsonBody() -> [String: Any] {
		var body: [String: Any] = [
			"name": name.trimmingCharacters(in: .whitespacesAndNewlines),
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
			body["persona"] = ["source": "default"]
		}
		return body
	}
}

struct FlowEditorNode: Identifiable, Equatable {
	var id: String
	var type: String
	var moduleName: String
	var toolName: String
	var constInputs: [String: String]
	var systemPrompt: String
	var userPrompt: String

	var isLLM: Bool { type == "llm_prompter" }

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
			constInputs: [:],
			systemPrompt: "Write a short status for the user. Reply with markdown only.",
			userPrompt: "Previous step output:\n\n{{json bag.result}}"
		)
	}

	init(stored: FlowStoredNode) {
		id = stored.id
		type = stored.type
		moduleName = stored.tool?.moduleName ?? ""
		toolName = stored.tool?.toolName ?? ""
		var inputs: [String: String] = [:]
		if let storedInputs = stored.inputs {
			for (key, source) in storedInputs {
				if let value = source.constValue {
					inputs[key] = value.editorString
				}
			}
		}
		constInputs = inputs
		systemPrompt = stored.systemPrompt ?? ""
		userPrompt = stored.userPrompt ?? ""
	}

	init(
		id: String,
		type: String,
		moduleName: String,
		toolName: String,
		constInputs: [String: String],
		systemPrompt: String,
		userPrompt: String
	) {
		self.id = id
		self.type = type
		self.moduleName = moduleName
		self.toolName = toolName
		self.constInputs = constInputs
		self.systemPrompt = systemPrompt
		self.userPrompt = userPrompt
	}

	func jsonBody() -> [String: Any] {
		if isLLM {
			return [
				"id": id,
				"type": "llm_prompter",
				"schema": ["kind": "markdown"],
				"systemPrompt": systemPrompt,
				"userPrompt": userPrompt,
				"promptHelpers": ["composePersona": true],
			]
		}
		var inputs: [String: Any] = [:]
		for (key, raw) in constInputs {
			let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
			if trimmed.isEmpty { continue }
			inputs[key] = ["const": FlowEditorNode.jsonConst(trimmed)]
		}
		var body: [String: Any] = [
			"id": id,
			"type": "tool_executor",
			"tool": ["moduleName": moduleName, "toolName": toolName],
		]
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

struct FlowEditorDestination: Identifiable, Equatable {
	var id: String
	var type: String
	var emailTo: String
	var emailSubject: String
	var slackChannel: String

	static func modal() -> FlowEditorDestination {
		FlowEditorDestination(id: UUID().uuidString, type: "modal", emailTo: "", emailSubject: "", slackChannel: "")
	}

	static func email() -> FlowEditorDestination {
		FlowEditorDestination(id: UUID().uuidString, type: "email", emailTo: "", emailSubject: "", slackChannel: "")
	}

	static func slack() -> FlowEditorDestination {
		FlowEditorDestination(id: UUID().uuidString, type: "slack", emailTo: "", emailSubject: "", slackChannel: "")
	}

	init(spec: FlowDestinationSpec) {
		id = UUID().uuidString
		type = spec.type
		emailTo = (spec.to ?? []).joined(separator: ", ")
		emailSubject = spec.subject ?? ""
		slackChannel = spec.channel ?? ""
	}

	init(id: String, type: String, emailTo: String, emailSubject: String, slackChannel: String) {
		self.id = id
		self.type = type
		self.emailTo = emailTo
		self.emailSubject = emailSubject
		self.slackChannel = slackChannel
	}

	var label: String {
		switch type {
		case "modal": return "Show a result window"
		case "email": return "Send email"
		case "slack": return "Post to Slack"
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
			return [
				"type": "email",
				"to": recipients,
				"subject": emailSubject,
			]
		case "slack":
			return ["type": "slack", "channel": slackChannel]
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
