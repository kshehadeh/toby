import Foundation
import Testing
@testable import TobyAI

@Suite("streamText / generateText")
struct TextGenerationTests {
	@Test func streamsTextDeltasAndUsage() async throws {
		let transport = MockTransport([
			.sse([": OPENROUTER PROCESSING", Chunks.text("Hel"), "", Chunks.text("lo")] + Chunks.finish("stop", cached: 4)),
		])
		let model = makeClient(transport).model("openai/gpt-5-mini")

		var deltas: [String] = []
		var final: TextResult?
		for try await part in streamText(TextRequest(model: model, instructions: "Be brief.", messages: [.user("Hi")])) {
			switch part {
			case let .textDelta(text): deltas.append(text)
			case let .finish(result): final = result
			default: break
			}
		}

		#expect(deltas == ["Hel", "lo"])
		let result = try #require(final)
		#expect(result.text == "Hello")
		#expect(result.finishReason == .stop)
		#expect(result.usage.inputTokens == 10)
		#expect(result.usage.cacheReadTokens == 4)
		#expect(result.steps.count == 1)

		let body = try #require(transport.requestBodies.first)
		#expect(body["model"] == "openai/gpt-5-mini")
		#expect(body["stream"] == true)
		#expect(body["messages"]?[0]?["role"] == "system")
		#expect(body["tools"] == nil)

		let request = try #require(transport.requests.first)
		#expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer sk-or-test")
		#expect(request.value(forHTTPHeaderField: "X-Title") == "Toby")
		#expect(request.url?.absoluteString == "https://openrouter.ai/api/v1/chat/completions")
	}

	@Test func runsToolLoopAcrossSteps() async throws {
		let transport = MockTransport([
			.sse([
				Chunks.toolCall(index: 0, id: "call_1", name: "getWeather", arguments: "{\"ci"),
				Chunks.toolCall(index: 0, arguments: "ty\":\"Paris\"}"),
			] + Chunks.finish("tool_calls")),
			.sse([Chunks.text("It's sunny in Paris.")] + Chunks.finish("stop")),
		])
		let weather = Tool(
			name: "getWeather",
			description: "Weather for a city",
			parameters: .object(["city": .string()]),
			readOnly: true,
		) { args, context in
			context.reportProgress(ToolProgress(message: "Looking up"))
			return ["city": args["city"] ?? .null, "forecast": "sunny"]
		}

		var parts: [StreamPart] = []
		let stream = streamText(TextRequest(
			model: makeClient(transport).model("openai/gpt-5-mini"),
			messages: [.user("Weather in Paris?")],
			tools: [weather],
			stopWhen: .stepCount(5),
		))
		for try await part in stream { parts.append(part) }

		guard case let .finish(result) = parts.last else {
			Issue.record("missing finish")
			return
		}
		#expect(result.steps.count == 2)
		#expect(result.text == "It's sunny in Paris.")
		#expect(result.usage.inputTokens == 20)
		let record = try #require(result.steps[0].toolResults.first)
		#expect(record.toolName == "getWeather")
		#expect(record.arguments == ["city": "Paris"])
		#expect(record.isError == false)
		#expect(result.responseMessages.map(\.role) == [.assistant, .tool, .assistant])

		#expect(parts.contains { if case .toolCallStart(id: "call_1", name: "getWeather") = $0 { true } else { false } })
		#expect(parts.contains { if case let .toolProgress(id: "call_1", progress) = $0 { progress.message == "Looking up" } else { false } })

		// Second request carries the assistant tool call and the tool result.
		let second = try #require(transport.requestBodies.last)
		let messages = try #require(second["messages"]?.arrayValue)
		#expect(messages.count == 3)
		#expect(messages[1]["tool_calls"]?[0]?["function"]?["arguments"] == "{\"city\":\"Paris\"}")
		#expect(messages[1]["content"] == .null)
		#expect(messages[2]["role"] == "tool")
		#expect(messages[2]["tool_call_id"] == "call_1")
	}

	@Test func defaultStopConditionIsOneStep() async throws {
		let transport = MockTransport([
			.sse([Chunks.toolCall(index: 0, id: "c", name: "noop", arguments: "{}")] + Chunks.finish("tool_calls")),
		])
		let noop = Tool(name: "noop", description: "Does nothing") { _, _ in "ok" }
		let result = try await generateText(TextRequest(
			model: makeClient(transport).model("m/x"),
			messages: [.user("go")],
			tools: [noop],
		))
		#expect(result.steps.count == 1)
		#expect(result.steps[0].toolResults.first?.result == "ok")
		#expect(transport.requests.count == 1)
	}

	@Test func unavailableAndFailingToolsReturnErrorsToModel() async throws {
		let transport = MockTransport([
			.sse([
				Chunks.toolCall(index: 0, id: "a", name: "hidden", arguments: "{}"),
				Chunks.toolCall(index: 1, id: "b", name: "boom", arguments: "{}"),
				Chunks.toolCall(index: 2, id: "c", name: "boom", arguments: "{not json"),
			] + Chunks.finish("tool_calls")),
			.sse([Chunks.text("Sorry.")] + Chunks.finish("stop")),
		])
		let hidden = Tool(name: "hidden", description: "h") { _, _ in "secret" }
		let boom = Tool(name: "boom", description: "b") { _, _ in throw ToolError("Disk on fire") }

		let result = try await generateText(TextRequest(
			model: makeClient(transport).model("m/x"),
			messages: [.user("go")],
			tools: [hidden, boom],
			activeTools: ["boom"],
			stopWhen: .stepCount(3),
		))
		let records = result.steps[0].toolResults
		#expect(records.map(\.callId) == ["a", "b", "c"])
		#expect(records.allSatisfy { $0.isError })
		#expect(records[0].result["error"]?.stringValue?.contains("not available") == true)
		#expect(records[1].result["error"] == "Disk on fire")
		#expect(records[2].result["error"]?.stringValue?.contains("not valid JSON") == true)

		let firstBody = try #require(transport.requestBodies.first)
		let offered = firstBody["tools"]?.arrayValue?.compactMap { $0["function"]?["name"]?.stringValue }
		#expect(offered == ["boom"])
	}

	@Test func prepareStepCanWidenActiveTools() async throws {
		let transport = MockTransport([
			.sse([Chunks.toolCall(index: 0, id: "a", name: "enableTools", arguments: "{}")] + Chunks.finish("tool_calls")),
			.sse([Chunks.text("done")] + Chunks.finish("stop")),
		])
		let enable = Tool(name: "enableTools", description: "e") { _, _ in "enabled" }
		let extra = Tool(name: "extra", description: "x") { _, _ in "x" }
		_ = try await generateText(TextRequest(
			model: makeClient(transport).model("m/x"),
			messages: [.user("go")],
			tools: [enable, extra],
			activeTools: ["enableTools"],
			stopWhen: .stepCount(4),
			prepareStep: { context in
				context.stepIndex > 0 ? StepOverrides(activeTools: ["enableTools", "extra"]) : nil
			},
		))
		let names = transport.requestBodies.map { body in
			Set(body["tools"]?.arrayValue?.compactMap { $0["function"]?["name"]?.stringValue } ?? [])
		}
		#expect(names == [["enableTools"], ["enableTools", "extra"]])
	}

	@Test func stopsWhenNamedToolIsCalled() async throws {
		let transport = MockTransport([
			.sse([Chunks.toolCall(index: 0, id: "a", name: "finalAnswer", arguments: "{}")] + Chunks.finish("tool_calls")),
		])
		let final = Tool(name: "finalAnswer", description: "f") { _, _ in "ok" }
		let result = try await generateText(TextRequest(
			model: makeClient(transport).model("m/x"),
			messages: [.user("go")],
			tools: [final],
			stopWhen: .any([.stepCount(10), .toolCalled("finalAnswer")]),
		))
		#expect(result.steps.count == 1)
		#expect(transport.requests.count == 1)
	}

	@Test func mapsHTTPErrors() async throws {
		let credits = MockTransport([.status(402, #"{"error":{"message":"Insufficient credits","code":402}}"#)])
		await #expect(throws: AIError.insufficientCredits(message: "Insufficient credits")) {
			try await generateText(TextRequest(model: makeClient(credits).model("m/x"), messages: [.user("hi")]))
		}

		let unauthorized = MockTransport([.status(401, "{}")])
		await #expect(throws: AIError.unauthorized) {
			try await generateText(TextRequest(model: makeClient(unauthorized).model("m/x"), messages: [.user("hi")]))
		}

		let noKey = MockTransport([])
		await #expect(throws: AIError.notSignedIn) {
			try await generateText(TextRequest(model: makeClient(noKey, key: nil).model("m/x"), messages: [.user("hi")]))
		}
	}

	@Test func retriesTransientFailuresBeforeOutput() async throws {
		let transport = MockTransport([
			.status(503, "{}"),
			.status(429, "{}", headers: ["Retry-After": "0"]),
			.sse([Chunks.text("ok")] + Chunks.finish("stop")),
		])
		let result = try await generateText(TextRequest(model: makeClient(transport).model("m/x"), messages: [.user("hi")]))
		#expect(result.text == "ok")
		#expect(transport.requests.count == 3)
	}

	@Test func surfacesMidStreamErrors() async throws {
		let transport = MockTransport([
			.sse([Chunks.text("par"), Chunks.line(["error": ["message": "Upstream overloaded", "code": 502]])]),
		])
		await #expect(throws: AIError.provider(message: "Upstream overloaded", code: 502)) {
			try await generateText(TextRequest(model: makeClient(transport).model("m/x"), messages: [.user("hi")]))
		}
	}

	@Test func sendsWebSearchReasoningAndLimits() async throws {
		let transport = MockTransport([.sse([Chunks.text("ok")] + Chunks.finish("stop"))])
		_ = try await generateText(TextRequest(
			model: makeClient(transport).model("m/x"),
			messages: [.user("hi")],
			temperature: 0.2,
			maxOutputTokens: 64,
			reasoning: .low,
			webSearch: WebSearchOptions(maxResults: 3),
		))
		let body = try #require(transport.requestBodies.first)
		#expect(body["temperature"] == 0.2)
		#expect(body["max_tokens"] == 64)
		#expect(body["reasoning"] == ["effort": "low"])
		#expect(body["plugins"] == [["id": "web", "max_results": 3]])
		#expect(body["usage"] == ["include": true])
	}
}
