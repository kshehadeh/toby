import Foundation

public enum Role: String, Sendable, Hashable, Codable {
	case system
	case user
	case assistant
	case tool
}

/// One piece of message content.
public enum ContentPart: Sendable, Hashable, Codable {
	case text(String)
	/// An image by `https:` URL or `data:` URL.
	case image(url: String)
	/// A file (e.g. PDF) as a `data:` URL.
	case file(filename: String, dataURL: String)
}

/// A tool invocation requested by the model.
public struct ToolCall: Sendable, Hashable, Codable {
	public var id: String
	public var name: String
	/// Raw JSON arguments text as produced by the model.
	public var arguments: String

	public init(id: String, name: String, arguments: String) {
		self.id = id
		self.name = name
		self.arguments = arguments
	}

	/// Parsed arguments; an empty or invalid payload parses as `{}`/throws.
	public func parsedArguments() throws -> JSONValue {
		let trimmed = arguments.trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed.isEmpty { return .object([:]) }
		return try JSONValue(parsing: trimmed)
	}
}

/// A conversation message in TobyAI's provider-neutral format.
public struct Message: Sendable, Hashable, Codable {
	public var role: Role
	public var content: [ContentPart]
	/// Assistant messages: tool calls requested in this step.
	public var toolCalls: [ToolCall]
	/// Tool messages: the call this result answers.
	public var toolCallId: String?
	/// Tool messages: the tool name (kept for transcripts/import fidelity).
	public var toolName: String?
	/// Assistant messages: reasoning text, if the model returned any.
	public var reasoning: String?
	/// Ask the gateway to place a prompt-cache breakpoint after this message.
	public var cacheBreakpoint: Bool

	public init(
		role: Role,
		content: [ContentPart] = [],
		toolCalls: [ToolCall] = [],
		toolCallId: String? = nil,
		toolName: String? = nil,
		reasoning: String? = nil,
		cacheBreakpoint: Bool = false,
	) {
		self.role = role
		self.content = content
		self.toolCalls = toolCalls
		self.toolCallId = toolCallId
		self.toolName = toolName
		self.reasoning = reasoning
		self.cacheBreakpoint = cacheBreakpoint
	}

	public static func system(_ text: String, cacheBreakpoint: Bool = false) -> Message {
		Message(role: .system, content: [.text(text)], cacheBreakpoint: cacheBreakpoint)
	}

	public static func user(_ text: String) -> Message {
		Message(role: .user, content: [.text(text)])
	}

	public static func user(_ parts: [ContentPart]) -> Message {
		Message(role: .user, content: parts)
	}

	public static func assistant(_ text: String, toolCalls: [ToolCall] = [], reasoning: String? = nil) -> Message {
		Message(
			role: .assistant,
			content: text.isEmpty ? [] : [.text(text)],
			toolCalls: toolCalls,
			reasoning: reasoning,
		)
	}

	public static func tool(callId: String, name: String, result: JSONValue) -> Message {
		let text: String = if case let .string(value) = result { value } else { result.jsonString() }
		return Message(role: .tool, content: [.text(text)], toolCallId: callId, toolName: name)
	}

	/// Concatenated text parts.
	public var text: String {
		content.compactMap { part in
			if case let .text(value) = part { return value }
			return nil
		}.joined()
	}
}
