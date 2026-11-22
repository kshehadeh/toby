import Foundation

// MARK: Request types

/// When the multi-step tool loop stops.
public indirect enum StopCondition: Sendable {
	/// Stop after this many model steps (AI SDK `stepCountIs`).
	case stepCount(Int)
	/// Stop once the model calls this tool.
	case toolCalled(String)
	/// Stop when any condition holds.
	case any([StopCondition])

	func shouldStop(steps: [StepResult]) -> Bool {
		switch self {
		case let .stepCount(count):
			return steps.count >= count
		case let .toolCalled(name):
			return steps.last?.toolCalls.contains { $0.name == name } ?? false
		case let .any(conditions):
			return conditions.contains { $0.shouldStop(steps: steps) }
		}
	}

	var maxSteps: Int {
		switch self {
		case let .stepCount(count): max(1, count)
		case .toolCalled: 32
		case let .any(conditions): conditions.map(\.maxSteps).min() ?? 32
		}
	}
}

public enum ToolChoice: Sendable, Hashable {
	case auto
	case none
	case required
	case tool(String)

	var wire: JSONValue {
		switch self {
		case .auto: "auto"
		case .none: "none"
		case .required: "required"
		case let .tool(name): ["type": "function", "function": ["name": .string(name)]]
		}
	}
}

public enum ReasoningEffort: String, Sendable, Hashable {
	case minimal, low, medium, high
}

/// OpenRouter's web-search plugin (replaces a dedicated search tool).
public struct WebSearchOptions: Sendable, Hashable {
	public var maxResults: Int
	public init(maxResults: Int = 5) { self.maxResults = maxResults }
}

/// Per-step adjustments returned by `prepareStep`.
public struct StepOverrides: Sendable {
	public var activeTools: Set<String>?
	public var toolChoice: ToolChoice?

	public init(activeTools: Set<String>? = nil, toolChoice: ToolChoice? = nil) {
		self.activeTools = activeTools
		self.toolChoice = toolChoice
	}
}

public struct StepContext: Sendable {
	public let stepIndex: Int
	public let steps: [StepResult]
	public let messages: [Message]
}

public struct TextRequest: Sendable {
	public var model: LanguageModel
	public var instructions: String?
	public var messages: [Message]
	public var tools: [Tool]
	/// Restrict which of `tools` are offered to the model (nil = all).
	public var activeTools: Set<String>?
	public var toolChoice: ToolChoice
	public var stopWhen: StopCondition
	public var temperature: Double?
	public var maxOutputTokens: Int?
	public var reasoning: ReasoningEffort?
	public var webSearch: WebSearchOptions?
	/// Mark the instructions as a prompt-cache breakpoint.
	public var cacheInstructions: Bool
	public var prepareStep: (@Sendable (StepContext) async -> StepOverrides?)?
	/// Additional top-level request fields (escape hatch).
	public var extraBody: [String: JSONValue]

	public init(
		model: LanguageModel,
		instructions: String? = nil,
		messages: [Message],
		tools: [Tool] = [],
		activeTools: Set<String>? = nil,
		toolChoice: ToolChoice = .auto,
		stopWhen: StopCondition = .stepCount(1),
		temperature: Double? = nil,
		maxOutputTokens: Int? = nil,
		reasoning: ReasoningEffort? = nil,
		webSearch: WebSearchOptions? = nil,
		cacheInstructions: Bool = true,
		prepareStep: (@Sendable (StepContext) async -> StepOverrides?)? = nil,
		extraBody: [String: JSONValue] = [:],
	) {
		self.model = model
		self.instructions = instructions
		self.messages = messages
		self.tools = tools
		self.activeTools = activeTools
		self.toolChoice = toolChoice
		self.stopWhen = stopWhen
		self.temperature = temperature
		self.maxOutputTokens = maxOutputTokens
		self.reasoning = reasoning
		self.webSearch = webSearch
		self.cacheInstructions = cacheInstructions
		self.prepareStep = prepareStep
		self.extraBody = extraBody
	}
}

// MARK: Results

public struct ToolResultRecord: Sendable, Hashable {
	public var callId: String
	public var toolName: String
	public var arguments: JSONValue
	public var result: JSONValue
	public var isError: Bool
	public var durationMs: Int
}

public struct StepResult: Sendable, Hashable {
	public var index: Int
	public var text: String
	public var reasoning: String
	public var toolCalls: [ToolCall]
	public var toolResults: [ToolResultRecord]
	public var finishReason: FinishReason
	public var usage: Usage
	/// Messages this step appended (assistant + tool results).
	public var responseMessages: [Message]
}

public struct TextResult: Sendable, Hashable {
	/// Text of the final step.
	public var text: String
	public var steps: [StepResult]
	public var usage: Usage
	public var finishReason: FinishReason
	/// All messages produced across steps, ready to append to the conversation.
	public var responseMessages: [Message]
}

public enum StreamPart: Sendable {
	case stepStart(index: Int)
	case textDelta(String)
	case reasoningDelta(String)
	case toolCallStart(id: String, name: String)
	case toolCallArgumentsDelta(id: String, delta: String)
	case toolCall(ToolCall)
	case toolProgress(id: String, ToolProgress)
	case toolResult(ToolResultRecord)
	case stepFinish(StepResult)
	case finish(TextResult)
}

// MARK: API

/// Stream a (possibly multi-step, tool-using) completion.
/// Cancel by cancelling the consuming task or terminating the stream.
public func streamText(_ request: TextRequest) -> AsyncThrowingStream<StreamPart, Error> {
	AsyncThrowingStream { continuation in
		let task = Task {
			do {
				let result = try await TextLoop(request: request, emit: { continuation.yield($0) }).run()
				continuation.yield(.finish(result))
				continuation.finish()
			} catch is CancellationError {
				continuation.finish(throwing: AIError.cancelled)
			} catch {
				continuation.finish(throwing: error)
			}
		}
		continuation.onTermination = { _ in task.cancel() }
	}
}

/// Run a completion (with tools/steps) to the end and return the result.
public func generateText(_ request: TextRequest) async throws -> TextResult {
	do {
		return try await TextLoop(request: request, emit: { _ in }).run()
	} catch is CancellationError {
		throw AIError.cancelled
	}
}

// MARK: Loop

struct TextLoop: Sendable {
	let request: TextRequest
	let emit: @Sendable (StreamPart) -> Void

	func run() async throws -> TextResult {
		var conversation: [Message] = []
		if let instructions = request.instructions, !instructions.isEmpty {
			conversation.append(.system(instructions, cacheBreakpoint: request.cacheInstructions))
		}
		conversation.append(contentsOf: request.messages)

		var steps: [StepResult] = []
		var produced: [Message] = []
		let toolsByName = Dictionary(request.tools.map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })

		for index in 0 ..< request.stopWhen.maxSteps {
			try Task.checkCancellation()
			let overrides = await request.prepareStep?(StepContext(stepIndex: index, steps: steps, messages: conversation))
			let active = overrides?.activeTools ?? request.activeTools
			let offered = request.tools.filter { active?.contains($0.name) ?? true }
			let choice = overrides?.toolChoice ?? request.toolChoice

			emit(.stepStart(index: index))
			let streamed = try await streamStep(messages: conversation, tools: offered, toolChoice: choice)

			var results: [ToolResultRecord] = []
			if !streamed.toolCalls.isEmpty {
				results = await executeTools(streamed.toolCalls, available: toolsByName, offered: Set(offered.map(\.name)))
			}

			var stepMessages: [Message] = [
				.assistant(streamed.text, toolCalls: streamed.toolCalls, reasoning: streamed.reasoning.isEmpty ? nil : streamed.reasoning),
			]
			for record in results {
				stepMessages.append(.tool(callId: record.callId, name: record.toolName, result: record.result))
			}
			conversation.append(contentsOf: stepMessages)
			produced.append(contentsOf: stepMessages)

			let step = StepResult(
				index: index,
				text: streamed.text,
				reasoning: streamed.reasoning,
				toolCalls: streamed.toolCalls,
				toolResults: results,
				finishReason: streamed.finishReason,
				usage: streamed.usage,
				responseMessages: stepMessages,
			)
			steps.append(step)
			emit(.stepFinish(step))

			if streamed.toolCalls.isEmpty || request.stopWhen.shouldStop(steps: steps) {
				break
			}
		}

		let last = steps.last
		return TextResult(
			text: last?.text ?? "",
			steps: steps,
			usage: steps.reduce(Usage.zero) { $0 + $1.usage },
			finishReason: last?.finishReason ?? .unknown,
			responseMessages: produced,
		)
	}

	// MARK: One model call

	struct StreamedStep {
		var text = ""
		var reasoning = ""
		var toolCalls: [ToolCall] = []
		var finishReason: FinishReason = .unknown
		var usage = Usage.zero
	}

	func body(messages: [Message], tools: [Tool], toolChoice: ToolChoice) -> JSONValue {
		var body: [String: JSONValue] = [
			"model": .string(request.model.id),
			"messages": WireFormat.messages(messages, modelId: request.model.id),
			"stream": true,
			"stream_options": ["include_usage": true],
			"usage": ["include": true],
		]
		if !tools.isEmpty {
			body["tools"] = WireFormat.tools(tools)
			body["tool_choice"] = toolChoice.wire
		}
		if let temperature = request.temperature { body["temperature"] = .number(temperature) }
		if let maxTokens = request.maxOutputTokens { body["max_tokens"] = .number(Double(maxTokens)) }
		if let reasoning = request.reasoning { body["reasoning"] = ["effort": .string(reasoning.rawValue)] }
		if let web = request.webSearch {
			body["plugins"] = [["id": "web", "max_results": .number(Double(web.maxResults))]]
		}
		for (key, value) in request.extraBody { body[key] = value }
		return .object(body)
	}

	func streamStep(messages: [Message], tools: [Tool], toolChoice: ToolChoice) async throws -> StreamedStep {
		let events = try await Retry.transient {
			try await request.model.client.sse(path: "chat/completions", body: body(messages: messages, tools: tools, toolChoice: toolChoice))
		}

		var step = StreamedStep()
		// Tool calls accumulate by `index`; ids/names arrive on the first delta.
		var pending: [Int: ToolCall] = [:]
		var order: [Int] = []

		for try await chunk in events {
			try Task.checkCancellation()
			if let error = chunk["error"], !error.isNull {
				throw AIError.provider(
					message: error["message"]?.stringValue ?? "The model returned an error.",
					code: error["code"]?.intValue,
				)
			}
			if let usage = WireFormat.usage(from: chunk["usage"]) {
				step.usage = usage
			}
			guard let choice = chunk["choices"]?[0] else { continue }
			let delta = choice["delta"]

			if let text = delta?["content"]?.stringValue, !text.isEmpty {
				step.text += text
				emit(.textDelta(text))
			}
			if let reasoning = delta?["reasoning"]?.stringValue, !reasoning.isEmpty {
				step.reasoning += reasoning
				emit(.reasoningDelta(reasoning))
			}
			for callDelta in delta?["tool_calls"]?.arrayValue ?? [] {
				let index = callDelta["index"]?.intValue ?? 0
				var call = pending[index] ?? ToolCall(id: "", name: "", arguments: "")
				let isNew = pending[index] == nil
				if let id = callDelta["id"]?.stringValue, !id.isEmpty { call.id = id }
				if let name = callDelta["function"]?["name"]?.stringValue, !name.isEmpty { call.name += name }
				let argsDelta = callDelta["function"]?["arguments"]?.stringValue ?? ""
				call.arguments += argsDelta
				if isNew {
					order.append(index)
					if call.id.isEmpty { call.id = "call_\(UUID().uuidString.prefix(12))" }
					emit(.toolCallStart(id: call.id, name: call.name))
				}
				pending[index] = call
				if !argsDelta.isEmpty { emit(.toolCallArgumentsDelta(id: call.id, delta: argsDelta)) }
			}
			if let reason = choice["finish_reason"]?.stringValue {
				step.finishReason = WireFormat.finishReason(reason)
			}
		}

		step.toolCalls = order.compactMap { pending[$0] }
		for call in step.toolCalls {
			emit(.toolCall(call))
		}
		return step
	}

	// MARK: Tool execution

	func executeTools(_ calls: [ToolCall], available: [String: Tool], offered: Set<String>) async -> [ToolResultRecord] {
		await withTaskGroup(of: (Int, ToolResultRecord).self) { group in
			for (position, call) in calls.enumerated() {
				group.addTask {
					(position, await execute(call, tool: offered.contains(call.name) ? available[call.name] : nil))
				}
			}
			var records = [ToolResultRecord?](repeating: nil, count: calls.count)
			for await (position, record) in group {
				records[position] = record
			}
			return records.compactMap(\.self)
		}
	}

	func execute(_ call: ToolCall, tool: Tool?) async -> ToolResultRecord {
		let started = ContinuousClock.now
		func finish(_ arguments: JSONValue, _ result: JSONValue, isError: Bool) -> ToolResultRecord {
			let elapsed = ContinuousClock.now - started
			let record = ToolResultRecord(
				callId: call.id,
				toolName: call.name,
				arguments: arguments,
				result: result,
				isError: isError,
				durationMs: Int(elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000),
			)
			emit(.toolResult(record))
			return record
		}

		guard let tool else {
			return finish(.null, ["error": .string("Tool \"\(call.name)\" is not available.")], isError: true)
		}
		let arguments: JSONValue
		do {
			arguments = try call.parsedArguments()
		} catch {
			return finish(.string(call.arguments), ["error": "The tool arguments were not valid JSON."], isError: true)
		}
		let context = ToolContext(toolCallId: call.id) { progress in
			emit(.toolProgress(id: call.id, progress))
		}
		do {
			let result = try await tool.execute(arguments, context)
			return finish(arguments, result, isError: false)
		} catch is CancellationError {
			return finish(arguments, ["error": "Cancelled."], isError: true)
		} catch {
			let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
			return finish(arguments, ["error": .string(message)], isError: true)
		}
	}
}

/// Retries a request that failed before producing output (429 / 5xx / network).
enum Retry {
	static func transient<T: Sendable>(attempts: Int = 3, _ body: @Sendable () async throws -> T) async throws -> T {
		var delay: Duration = .milliseconds(500)
		for attempt in 1 ... attempts {
			do {
				return try await body()
			} catch {
				guard attempt < attempts, isTransient(error) else { throw error }
				if case let AIError.rateLimited(retry?) = error {
					try await Task.sleep(for: .seconds(min(retry, 10)))
				} else {
					try await Task.sleep(for: delay)
				}
				delay *= 2
			}
		}
		preconditionFailure("unreachable")
	}

	static func isTransient(_ error: Error) -> Bool {
		switch error {
		case AIError.rateLimited: true
		case let AIError.http(status, _): status >= 500
		case let urlError as URLError:
			[.timedOut, .networkConnectionLost, .cannotConnectToHost].contains(urlError.code)
		default: false
		}
	}
}
