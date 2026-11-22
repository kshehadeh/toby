import Foundation

/// How structured output is requested from the model.
public enum StructuredOutputMode: Sendable, Hashable {
	/// `response_format: json_schema` with `strict: true` (requires `structured_outputs` support).
	case jsonSchema
	/// Schema described in the prompt + `response_format: json_object`; for models without strict schemas.
	case jsonPrompt
}

public struct ObjectRequest: Sendable {
	public var model: LanguageModel
	public var instructions: String?
	public var messages: [Message]
	public var schema: JSONSchema
	/// Schema name sent to the provider (letters, digits, underscores).
	public var schemaName: String
	public var schemaDescription: String?
	public var mode: StructuredOutputMode
	public var temperature: Double?
	public var maxOutputTokens: Int?
	/// Re-ask once with the decode error when the first answer doesn't parse.
	public var repairAttempts: Int

	public init(
		model: LanguageModel,
		instructions: String? = nil,
		messages: [Message],
		schema: JSONSchema,
		schemaName: String,
		schemaDescription: String? = nil,
		mode: StructuredOutputMode = .jsonSchema,
		temperature: Double? = nil,
		maxOutputTokens: Int? = nil,
		repairAttempts: Int = 1,
	) {
		self.model = model
		self.instructions = instructions
		self.messages = messages
		self.schema = schema
		self.schemaName = schemaName
		self.schemaDescription = schemaDescription
		self.mode = mode
		self.temperature = temperature
		self.maxOutputTokens = maxOutputTokens
		self.repairAttempts = repairAttempts
	}
}

public struct ObjectResult<T: Sendable>: Sendable {
	public var object: T
	public var raw: JSONValue
	public var usage: Usage
}

/// Generate a value matching `schema` and decode it as `T`
/// (AI SDK `generateText({ output: Output.object(...) })`).
public func generateObject<T: Decodable & Sendable>(
	_ request: ObjectRequest,
	as _: T.Type = T.self,
) async throws -> ObjectResult<T> {
	let raw = try await generateJSON(request)
	do {
		return ObjectResult(object: try raw.object.decode(as: T.self), raw: raw.object, usage: raw.usage)
	} catch {
		throw AIError.invalidStructuredOutput(raw: raw.object.jsonString(), reason: String(describing: error))
	}
}

/// Generate a raw JSON value matching `schema`.
public func generateJSON(_ request: ObjectRequest) async throws -> (object: JSONValue, usage: Usage) {
	var messages: [Message] = []
	var instructions = request.instructions ?? ""
	if request.mode == .jsonPrompt {
		instructions += (instructions.isEmpty ? "" : "\n\n")
			+ "Respond with a single JSON object only (no prose, no code fences) that matches this JSON Schema:\n"
			+ request.schema.value.jsonString()
	}
	if !instructions.isEmpty {
		messages.append(.system(instructions, cacheBreakpoint: true))
	}
	messages.append(contentsOf: request.messages)

	var usage = Usage.zero
	var attempt = 0
	while true {
		let requestBody = body(for: request, messages: messages)
		let response = try await Retry.transient {
			try await request.model.client.json(path: "chat/completions", body: requestBody)
		}
		usage = usage + (WireFormat.usage(from: response["usage"]) ?? .zero)
		let content = response["choices"]?[0]?["message"]?["content"]?.stringValue ?? ""
		do {
			return (try parseJSONObject(content), usage)
		} catch {
			guard attempt < request.repairAttempts else {
				throw AIError.invalidStructuredOutput(raw: content, reason: "not valid JSON")
			}
			attempt += 1
			messages.append(.assistant(content))
			messages.append(.user("That was not valid JSON for the required schema. Reply again with only the corrected JSON object."))
		}
	}
}

private func body(for request: ObjectRequest, messages: [Message]) -> JSONValue {
	var body: [String: JSONValue] = [
		"model": .string(request.model.id),
		"messages": WireFormat.messages(messages, modelId: request.model.id),
		"usage": ["include": true],
	]
	switch request.mode {
	case .jsonSchema:
		var schema: [String: JSONValue] = [
			"name": .string(request.schemaName),
			"strict": true,
			"schema": request.schema.value,
		]
		if let description = request.schemaDescription { schema["description"] = .string(description) }
		body["response_format"] = ["type": "json_schema", "json_schema": .object(schema)]
		// Only route to upstreams that honor the requested parameters.
		body["provider"] = ["require_parameters": true]
	case .jsonPrompt:
		body["response_format"] = ["type": "json_object"]
	}
	if let temperature = request.temperature { body["temperature"] = .number(temperature) }
	if let maxTokens = request.maxOutputTokens { body["max_tokens"] = .number(Double(maxTokens)) }
	return .object(body)
}

/// Parse a model reply as JSON, tolerating code fences and leading prose.
func parseJSONObject(_ text: String) throws -> JSONValue {
	let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
	if let value = try? JSONValue(parsing: trimmed) { return value }
	var candidate = trimmed
	if candidate.hasPrefix("```") {
		candidate = candidate.drop(while: { $0 != "\n" }).dropFirst().description
		if let fence = candidate.range(of: "```", options: .backwards) {
			candidate = String(candidate[..<fence.lowerBound])
		}
		if let value = try? JSONValue(parsing: candidate) { return value }
	}
	if let start = trimmed.firstIndex(where: { $0 == "{" || $0 == "[" }),
	   let end = trimmed.lastIndex(where: { $0 == "}" || $0 == "]" }), start < end
	{
		return try JSONValue(parsing: String(trimmed[start ... end]))
	}
	throw AIError.invalidStructuredOutput(raw: text, reason: "no JSON found")
}
