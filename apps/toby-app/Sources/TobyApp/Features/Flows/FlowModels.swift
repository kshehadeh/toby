import Foundation
import SwiftUI

// MARK: - API models

struct FlowListItem: Decodable, Identifiable, Equatable {
	let id: String
	let name: String
	let description: String?
	let builtin: Bool
	let persona: FlowPersonaSpec?
	let nodes: [FlowNodeSnapshot]
	let result: FlowResultPointer?
	let destinations: [FlowDestinationSpec]?
	let createdAt: String?
	let updatedAt: String?

	/// Prefer a short human label over the raw dotted id used for built-ins.
	var displayName: String {
		let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed.isEmpty || trimmed == id {
			return Self.humanizeFlowId(id)
		}
		return trimmed
	}

	var subtitle: String {
		if let description, !description.isEmpty {
			return description
		}
		return "\(nodes.count) node\(nodes.count == 1 ? "" : "s")"
	}

	var personaLabel: String {
		guard let persona else { return "Default" }
		switch persona.source {
		case "named":
			return persona.name?.isEmpty == false ? (persona.name ?? "Named") : "Named"
		case "dashboard":
			return "Dashboard"
		case "default":
			return "Default"
		default:
			return persona.source.capitalized
		}
	}

	var systemImage: String {
		if id.contains("email") { return "envelope" }
		if id.contains("task") { return "checklist" }
		if id.contains("calendar") { return "calendar" }
		return "arrow.triangle.branch"
	}

	static func humanizeFlowId(_ id: String) -> String {
		let parts = id
			.split(separator: ".")
			.map(String.init)
			.filter { !$0.isEmpty }
		guard !parts.isEmpty else { return id }
		if parts.count >= 2 {
			return parts.suffix(2).map { $0.replacingOccurrences(of: "_", with: " ").capitalized }.joined(separator: " ")
		}
		return parts[0].replacingOccurrences(of: "_", with: " ").capitalized
	}
}

struct FlowPersonaSpec: Decodable, Equatable {
	let source: String
	let name: String?
}

struct FlowNodeSnapshot: Decodable, Identifiable, Equatable {
	let id: String
	let type: String
	let tool: FlowToolRef?
	let schemaName: String?
	let temperature: Double?
	let maxOutputTokens: Int?
	let inputs: [String: FlowInputSourceSnapshot]?
	let outputs: [String: String]?

	var typeLabel: String {
		switch type {
		case "tool_executor": return "Tool Executor"
		case "llm_prompter": return "LLM Prompter"
		default: return type.replacingOccurrences(of: "_", with: " ").capitalized
		}
	}

	var detailLabel: String {
		if type == "tool_executor", let tool {
			return tool.displayLabel
		}
		if type == "llm_prompter" {
			return schemaName ?? "Structured output"
		}
		return typeLabel
	}

	var systemImage: String {
		switch type {
		case "tool_executor": return "wrench.and.screwdriver"
		case "llm_prompter": return "text.bubble"
		default: return "circle.grid.2x2"
		}
	}
}

struct FlowToolRef: Decodable, Equatable {
	let standardTool: String?
	let moduleName: String?
	let toolName: String?

	var displayLabel: String {
		if let standardTool, !standardTool.isEmpty {
			return standardTool
		}
		if let moduleName, let toolName {
			return "\(moduleName).\(toolName)"
		}
		return toolName ?? moduleName ?? "Tool"
	}
}

struct FlowInputSourceSnapshot: Decodable, Equatable {
	let constValue: AnyCodable?
	let from: String?
	let path: String?

	enum CodingKeys: String, CodingKey {
		case constValue = "const"
		case from
		case path
	}

	var summary: String {
		if let from {
			if let path, !path.isEmpty, path != "." {
				return "from \(from).\(path)"
			}
			return "from \(from)"
		}
		if let constValue {
			return "const \(constValue.displayString)"
		}
		return "—"
	}
}

struct FlowRunSummary: Decodable, Identifiable, Equatable {
	let id: String
	let flowName: String
	let status: String
	let personaName: String?
	let provider: String?
	let model: String?
	let trigger: String?
	let error: String?
	let failedNodeId: String?
	let startedAt: String
	let completedAt: String?
	let durationMs: Int?

	var displayStatus: String { status.capitalized }

	var isRunning: Bool { status == "running" }

	var statusColor: Color {
		switch status.lowercased() {
		case "success": return .green
		case "error": return .red
		case "running": return .orange
		default: return AppTheme.tertiaryText
		}
	}

	var statusIcon: String {
		switch status.lowercased() {
		case "success": return "checkmark.circle.fill"
		case "error": return "xmark.circle.fill"
		case "running": return "arrow.triangle.2.circlepath"
		default: return "circle"
		}
	}

	var durationLabel: String {
		guard let durationMs else {
			return isRunning ? "Running…" : "—"
		}
		if durationMs < 1000 {
			return "\(durationMs) ms"
		}
		let seconds = Double(durationMs) / 1000
		if seconds < 60 {
			return String(format: "%.1f s", seconds)
		}
		let minutes = Int(seconds) / 60
		let rem = Int(seconds) % 60
		return "\(minutes)m \(rem)s"
	}

	var startedLabel: String {
		guard let date = FlowISO8601.date(from: startedAt) else { return startedAt }
		return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
	}

	var triggerLabel: String {
		guard let trigger, !trigger.isEmpty else { return "—" }
		return trigger
	}
}

struct FlowRunDetail: Decodable, Identifiable, Equatable {
	let id: String
	let flowName: String
	let status: String
	let personaName: String?
	let provider: String?
	let model: String?
	let trigger: String?
	let error: String?
	let failedNodeId: String?
	let startedAt: String
	let completedAt: String?
	let durationMs: Int?
	let definitionSnapshot: FlowDefinitionSnapshot?
	let initialInputs: AnyCodable?
	let finalOutputs: AnyCodable?
	let destinationResults: [FlowDestinationDelivery]?
	let nodes: [FlowRunNodeDetail]

	var displayStatus: String { status.capitalized }
	var isRunning: Bool { status == "running" }

	var statusColor: Color {
		switch status.lowercased() {
		case "success": return .green
		case "error": return .red
		case "running": return .orange
		default: return AppTheme.tertiaryText
		}
	}

	var statusIcon: String {
		switch status.lowercased() {
		case "success": return "checkmark.circle.fill"
		case "error": return "xmark.circle.fill"
		case "running": return "arrow.triangle.2.circlepath"
		default: return "circle"
		}
	}

	var durationLabel: String {
		guard let durationMs else {
			return isRunning ? "Running…" : "—"
		}
		if durationMs < 1000 {
			return "\(durationMs) ms"
		}
		let seconds = Double(durationMs) / 1000
		if seconds < 60 {
			return String(format: "%.1f s", seconds)
		}
		let minutes = Int(seconds) / 60
		let rem = Int(seconds) % 60
		return "\(minutes)m \(rem)s"
	}

	var startedLabel: String {
		guard let date = FlowISO8601.date(from: startedAt) else { return startedAt }
		return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
	}
}

struct FlowDefinitionSnapshot: Decodable, Equatable {
	let name: String
	let description: String?
	let nodes: [FlowNodeSnapshot]
}

struct FlowRunNodeDetail: Decodable, Identifiable, Equatable {
	let id: String
	let runId: String?
	let nodeId: String
	let nodeType: String
	let nodeOrder: Int
	let status: String
	let inputs: AnyCodable?
	let outputs: AnyCodable?
	let error: String?
	let durationMs: Int?
	let startedAt: String?
	let completedAt: String?
	let detail: AnyCodable?

	var typeLabel: String {
		switch nodeType {
		case "tool_executor": return "Tool Executor"
		case "llm_prompter": return "LLM Prompter"
		default: return nodeType.replacingOccurrences(of: "_", with: " ").capitalized
		}
	}

	var statusColor: Color {
		switch status.lowercased() {
		case "success": return .green
		case "error": return .red
		case "running": return .orange
		case "skipped": return AppTheme.tertiaryText
		default: return AppTheme.tertiaryText
		}
	}

	var durationLabel: String {
		guard let durationMs else { return "—" }
		if durationMs < 1000 {
			return "\(durationMs) ms"
		}
		return String(format: "%.1f s", Double(durationMs) / 1000)
	}
}

struct FlowResultPointer: Decodable, Equatable {
	let from: String
	let path: String?
}

struct FlowDestinationSpec: Decodable, Equatable {
	let type: String
	let to: [String]?
	let subject: String?
	let cc: [String]?
	let channel: String?
	let variant: String?

	var summary: String {
		switch type {
		case "modal":
			return "Show result"
		case "email":
			let recipients = (to ?? []).joined(separator: ", ")
			return recipients.isEmpty ? "Email" : "Email \(recipients)"
		case "slack":
			return channel?.isEmpty == false ? "Slack \(channel ?? "")" : "Slack"
		case "dashboard":
			return variant == "runner" ? "Dashboard · Run now" : "Dashboard · Informational"
		default:
			return type.capitalized
		}
	}
}

struct FlowDestinationDelivery: Decodable, Equatable {
	let type: String
	let ok: Bool
	let error: String?
}

struct FlowExtractedResult: Decodable, Equatable {
	let text: String
	let format: String
	let pointer: FlowResultPointer?
}

struct FlowRunNowResponse: Decodable, Equatable {
	let ok: Bool
	let runId: String?
	let error: String?
	let failedNodeId: String?
	let result: FlowExtractedResult?
	let destinations: [FlowDestinationDelivery]?
}

struct FlowToolCatalog: Equatable {
	let modules: [FlowCatalogModule]

	static func parse(_ data: Data) throws -> FlowToolCatalog {
		let object: Any
		do {
			object = try JSONSerialization.jsonObject(with: data)
		} catch {
			throw TobyClientError.serverError("Flow catalog was not valid JSON.")
		}
		guard let root = object as? [String: Any] else {
			throw TobyClientError.serverError("Flow catalog was not an object.")
		}
		let rawModules = root["modules"] as? [[String: Any]] ?? []
		return FlowToolCatalog(modules: rawModules.compactMap(FlowCatalogModule.parse))
	}
}

struct FlowCatalogModule: Equatable, Identifiable {
	var id: String { name }
	let name: String
	let displayName: String
	let connected: Bool
	let tools: [FlowCatalogTool]

	init(name: String, displayName: String, connected: Bool, tools: [FlowCatalogTool]) {
		self.name = name
		self.displayName = displayName
		self.connected = connected
		self.tools = tools
	}

	init?(plugin: PluginSummary) {
		guard plugin.state == "valid" else { return nil }
		let tools = (plugin.tools ?? []).map { FlowCatalogTool(moduleName: plugin.name, tool: $0) }
		guard !tools.isEmpty else { return nil }
		self.init(
			name: plugin.name,
			displayName: plugin.displayName,
			connected: plugin.connected,
			tools: tools
		)
	}

	static func parse(_ raw: [String: Any]) -> FlowCatalogModule? {
		guard let name = raw["name"] as? String, !name.isEmpty else { return nil }
		let tools = (raw["tools"] as? [[String: Any]] ?? []).compactMap(FlowCatalogTool.parse)
		return FlowCatalogModule(
			name: name,
			displayName: (raw["displayName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? name,
			connected: raw["connected"] as? Bool ?? false,
			tools: tools
		)
	}
}

struct FlowCatalogTool: Equatable, Identifiable {
	var id: String { "\(moduleName).\(toolName)" }
	let moduleName: String
	let toolName: String
	let displayName: String?
	let description: String?
	let readOnly: Bool?
	let standardTool: String?
	let inputSchema: FlowInputSchema

	var label: String { displayName?.isEmpty == false ? (displayName ?? toolName) : toolName }

	var requiredFields: [String] { inputSchema.required ?? [] }

	func property(named name: String) -> FlowInputProperty? {
		inputSchema.properties?[name]
	}

	var looksLikeRuntimeIdRequired: Bool {
		requiredFields.contains { field in
			let lower = field.lowercased()
			return lower == "uids" || lower.hasSuffix("ids") || lower == "id" || lower.hasSuffix("id")
		}
	}

	init(
		moduleName: String,
		toolName: String,
		displayName: String?,
		description: String?,
		readOnly: Bool?,
		standardTool: String?,
		inputSchema: FlowInputSchema
	) {
		self.moduleName = moduleName
		self.toolName = toolName
		self.displayName = displayName
		self.description = description
		self.readOnly = readOnly
		self.standardTool = standardTool
		self.inputSchema = inputSchema
	}

	init(moduleName: String, tool: IntegrationToolDefinition) {
		self.moduleName = moduleName
		self.toolName = tool.name
		self.displayName = tool.displayName
		self.description = tool.description
		self.readOnly = tool.readOnly
		self.standardTool = tool.standardTool
		self.inputSchema = tool.inputSchema ?? FlowInputSchema(type: "object", properties: [:], required: nil)
	}

	static func parse(_ raw: [String: Any]) -> FlowCatalogTool? {
		guard
			let moduleName = raw["moduleName"] as? String, !moduleName.isEmpty,
			let toolName = raw["toolName"] as? String, !toolName.isEmpty
		else { return nil }
		return FlowCatalogTool(
			moduleName: moduleName,
			toolName: toolName,
			displayName: raw["displayName"] as? String,
			description: raw["description"] as? String,
			readOnly: raw["readOnly"] as? Bool,
			standardTool: raw["standardTool"] as? String,
			inputSchema: FlowInputSchema.parse(raw["inputSchema"])
		)
	}
}

struct FlowInputSchema: Equatable, Decodable {
	let type: String?
	let properties: [String: FlowInputProperty]?
	let required: [String]?

	enum CodingKeys: String, CodingKey {
		case type, properties, required
	}

	init(type: String?, properties: [String: FlowInputProperty]?, required: [String]?) {
		self.type = type
		self.properties = properties
		self.required = required
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		type = try? container.decode(String.self, forKey: .type)
		required = try? container.decode([String].self, forKey: .required)
		properties = try? container.decode([String: FlowInputProperty].self, forKey: .properties)
	}

	static func parse(_ raw: Any?) -> FlowInputSchema {
		guard let object = raw as? [String: Any] else {
			return FlowInputSchema(type: "object", properties: [:], required: nil)
		}
		var properties: [String: FlowInputProperty] = [:]
		if let props = object["properties"] as? [String: Any] {
			for (key, value) in props {
				properties[key] = FlowInputProperty.parse(value)
			}
		}
		let required = (object["required"] as? [Any])?.compactMap { $0 as? String }
		return FlowInputSchema(
			type: object["type"] as? String,
			properties: properties,
			required: required
		)
	}
}

struct FlowInputProperty: Equatable, Decodable {
	let type: String?
	let description: String?

	enum CodingKeys: String, CodingKey {
		case type, description
	}

	init(type: String?, description: String?) {
		self.type = type
		self.description = description
	}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		if let stringType = try? container.decode(String.self, forKey: .type) {
			type = stringType
		} else if let types = try? container.decode([String].self, forKey: .type) {
			type = types.first
		} else {
			type = nil
		}
		description = try? container.decode(String.self, forKey: .description)
	}

	static func parse(_ raw: Any?) -> FlowInputProperty {
		guard let object = raw as? [String: Any] else {
			return FlowInputProperty(type: nil, description: nil)
		}
		let type: String?
		if let stringType = object["type"] as? String {
			type = stringType
		} else if let types = object["type"] as? [String] {
			type = types.first
		} else {
			type = nil
		}
		return FlowInputProperty(
			type: type,
			description: object["description"] as? String
		)
	}
}

struct FlowDocumentPayload: Decodable, Equatable {
	let id: String
	let name: String
	let description: String?
	let persona: FlowPersonaSpec?
	let nodes: [FlowStoredNode]
	let result: FlowResultPointer?
	let destinations: [FlowDestinationSpec]?
}

struct FlowStoredNode: Decodable, Equatable {
	let id: String
	let type: String
	let tool: FlowToolRef?
	let inputs: [String: FlowInputSourceSnapshot]?
	let outputs: [String: String]?
	let schema: FlowSchemaKind?
	let systemPrompt: String?
	let userPrompt: String?
}

struct FlowSchemaKind: Decodable, Equatable {
	let kind: String
}

struct FlowMutationResponse: Decodable {
	let flow: FlowListItem
	let document: FlowDocumentPayload?
}

// MARK: - Helpers

enum FlowISO8601 {
	static func date(from string: String) -> Date? {
		let fractional = ISO8601DateFormatter()
		fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		if let date = fractional.date(from: string) {
			return date
		}
		let plain = ISO8601DateFormatter()
		plain.formatOptions = [.withInternetDateTime]
		return plain.date(from: string)
	}
}

extension AnyCodable {
	var displayString: String {
		if let s = value as? String { return s }
		if let b = value as? Bool { return b ? "true" : "false" }
		if let i = value as? Int { return String(i) }
		if let d = value as? Double { return String(d) }
		if let arr = value as? [AnyCodable] {
			return "[\(arr.count) item\(arr.count == 1 ? "" : "s")]"
		}
		if let dict = value as? [String: AnyCodable] {
			return "{\(dict.count) key\(dict.count == 1 ? "" : "s")}"
		}
		if value is NSNull { return "null" }
		return String(describing: value)
	}

	/// Pretty JSON when possible; otherwise a short display string.
	func prettyPrinted(maxLength: Int = 8_000) -> String {
		func unwrap(_ any: Any) -> Any {
			if let c = any as? AnyCodable { return unwrap(c.value) }
			if let arr = any as? [AnyCodable] { return arr.map { unwrap($0.value) } }
			if let dict = any as? [String: AnyCodable] {
				return dict.mapValues { unwrap($0.value) }
			}
			return any
		}
		let raw = unwrap(value)
		if JSONSerialization.isValidJSONObject(raw),
			let data = try? JSONSerialization.data(withJSONObject: raw, options: [.prettyPrinted, .sortedKeys]),
			let text = String(data: data, encoding: .utf8)
		{
			if text.count <= maxLength { return text }
			return String(text.prefix(maxLength)) + "\n…"
		}
		let s = displayString
		if s.count <= maxLength { return s }
		return String(s.prefix(maxLength)) + "…"
	}
}
