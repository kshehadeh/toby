import Foundation

/// Progress a tool reports while it runs (surfaced to the UI as `tool_call_progress`).
public struct ToolProgress: Sendable, Hashable {
	public var message: String?
	/// 0...1 when known.
	public var fraction: Double?

	public init(message: String? = nil, fraction: Double? = nil) {
		self.message = message
		self.fraction = fraction
	}
}

/// Per-invocation context handed to a tool's `execute`.
public struct ToolContext: Sendable {
	public let toolCallId: String
	public let reportProgress: @Sendable (ToolProgress) -> Void

	public init(toolCallId: String, reportProgress: @escaping @Sendable (ToolProgress) -> Void = { _ in }) {
		self.toolCallId = toolCallId
		self.reportProgress = reportProgress
	}
}

/// A function the model can call.
public struct Tool: Sendable {
	public var name: String
	public var description: String
	public var parameters: JSONSchema
	/// Read-only tools are safe to cache and to run without side effects.
	public var readOnly: Bool
	public var execute: @Sendable (JSONValue, ToolContext) async throws -> JSONValue

	public init(
		name: String,
		description: String,
		parameters: JSONSchema = .empty,
		readOnly: Bool = false,
		execute: @escaping @Sendable (JSONValue, ToolContext) async throws -> JSONValue,
	) {
		self.name = name
		self.description = description
		self.parameters = parameters
		self.readOnly = readOnly
		self.execute = execute
	}

	/// Typed convenience: decode arguments into `Args`, encode the `Result`.
	public static func typed<Args: Decodable & Sendable, Result: Encodable & Sendable>(
		name: String,
		description: String,
		parameters: JSONSchema,
		readOnly: Bool = false,
		execute: @escaping @Sendable (Args, ToolContext) async throws -> Result,
	) -> Tool {
		Tool(name: name, description: description, parameters: parameters, readOnly: readOnly) { raw, context in
			let args: Args = try raw.decode()
			let result = try await execute(args, context)
			return try JSONValue(encoding: result)
		}
	}
}

/// Thrown by a tool to return a model-visible error message.
public struct ToolError: Error, Sendable, LocalizedError {
	public var message: String
	public init(_ message: String) { self.message = message }
	public var errorDescription: String? { message }
}
