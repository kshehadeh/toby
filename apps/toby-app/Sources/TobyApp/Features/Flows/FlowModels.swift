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
