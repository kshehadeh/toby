import Foundation
import Testing
@testable import TobyAI

@Suite("generateObject")
struct GenerateObjectTests {
	struct Ranking: Decodable, Sendable, Equatable {
		let ids: [String]
		let note: String?
	}

	static let schema = JSONSchema.object(
		["ids": .array(.string()), "note": .string()],
		optional: ["note"],
	)

	static func completion(_ content: String) -> MockTransport.Reply {
		.json(200, [
			"choices": [["message": ["role": "assistant", "content": .string(content)]]],
			"usage": ["prompt_tokens": 7, "completion_tokens": 3],
		])
	}

	@Test func requestsStrictJSONSchemaAndDecodes() async throws {
		let transport = MockTransport([Self.completion(#"{"ids":["a","b"],"note":null}"#)])
		let result = try await generateObject(ObjectRequest(
			model: makeClient(transport).model("openai/gpt-5-mini"),
			instructions: "Rank these.",
			messages: [.user("a, b")],
			schema: Self.schema,
			schemaName: "FeedRanking",
			temperature: 0.2,
		), as: Ranking.self)

		#expect(result.object == Ranking(ids: ["a", "b"], note: nil))
		#expect(result.usage.inputTokens == 7)
		let body = try #require(transport.requestBodies.first)
		#expect(body["response_format"]?["type"] == "json_schema")
		#expect(body["response_format"]?["json_schema"]?["name"] == "FeedRanking")
		#expect(body["response_format"]?["json_schema"]?["strict"] == true)
		#expect(body["provider"] == ["require_parameters": true])
		// Required parameters must not include temperature: reasoning models reject it.
		#expect(body["temperature"] == nil)
		#expect(body["stream"] == nil)
	}

	@Test func repairsInvalidJSONOnce() async throws {
		let transport = MockTransport([
			Self.completion("Sure! Here you go:"),
			Self.completion("```json\n{\"ids\":[\"z\"],\"note\":\"fixed\"}\n```"),
		])
		let result = try await generateObject(ObjectRequest(
			model: makeClient(transport).model("m/x"),
			messages: [.user("go")],
			schema: Self.schema,
			schemaName: "R",
		), as: Ranking.self)
		#expect(result.object == Ranking(ids: ["z"], note: "fixed"))
		#expect(result.usage.inputTokens == 14)
		let repair = try #require(transport.requestBodies.last?["messages"]?.arrayValue)
		#expect(repair.last?["role"] == "user")
	}

	@Test func jsonPromptModeDescribesSchemaInInstructions() async throws {
		let transport = MockTransport([Self.completion(#"prefix {"ids":[],"note":null} suffix"#)])
		let result = try await generateObject(ObjectRequest(
			model: makeClient(transport).model("m/x"),
			messages: [.user("go")],
			schema: Self.schema,
			schemaName: "R",
			mode: .jsonPrompt,
		), as: Ranking.self)
		#expect(result.object.ids.isEmpty)
		let body = try #require(transport.requestBodies.first)
		#expect(body["response_format"] == ["type": "json_object"])
		#expect(body["messages"]?[0]?["content"]?.stringValue?.contains("JSON Schema") == true)
	}

	@Test func decodeMismatchThrowsStructuredError() async throws {
		let transport = MockTransport([Self.completion(#"{"ids":"nope"}"#)])
		await #expect(throws: AIError.self) {
			try await generateObject(ObjectRequest(
				model: makeClient(transport).model("m/x"),
				messages: [.user("go")],
				schema: Self.schema,
				schemaName: "R",
			), as: Ranking.self)
		}
	}
}

@Suite("Embeddings and vectors")
struct EmbeddingTests {
	@Test func batchesAndPreservesOrder() async throws {
		let transport = MockTransport([
			.json(200, ["data": [["index": 1, "embedding": [0, 1]], ["index": 0, "embedding": [1, 0]]], "usage": ["prompt_tokens": 4]]),
			.json(200, ["data": [["index": 0, "embedding": [1, 1]]], "usage": ["prompt_tokens": 2]]),
		])
		let result = try await makeClient(transport).embeddingModel().embedMany(["a", "b", "c"], batchSize: 2)
		#expect(result.embeddings == [[1, 0], [0, 1], [1, 1]])
		#expect(result.usage.inputTokens == 6)
		#expect(transport.requestBodies.first?["model"] == "openai/text-embedding-3-small")
		#expect(transport.requests.first?.url?.lastPathComponent == "embeddings")
	}

	@Test func cosineAndTopK() {
		#expect(abs(VectorMath.cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-6)
		#expect(abs(VectorMath.cosineSimilarity([1, 0], [0, 1])) < 1e-6)
		let top = VectorMath.topK(
			query: [1, 0],
			candidates: [("x", [0, 1]), ("y", [1, 0.1]), ("z", [1, 1])],
			k: 2,
			minScore: 0.1,
		)
		#expect(top.map(\.id) == ["y", "z"])
	}

	@Test func blobRoundTripsLittleEndianFloat32() {
		let vector: [Float] = [0.5, -1.25, 3]
		let blob = VectorMath.blob(vector)
		#expect(blob.count == 12)
		#expect(Array(blob.prefix(4)) == [0x00, 0x00, 0x00, 0x3F])
		#expect(VectorMath.vector(fromBlob: blob) == vector)
	}
}

@Suite("Wire format and schemas")
struct WireFormatTests {
	@Test func anthropicGetsCacheBreakpointOpenAIDoesNot() {
		let system = Message.system("You are Toby.", cacheBreakpoint: true)
		let anthropic = WireFormat.messages([system], modelId: "anthropic/claude-sonnet-5")
		#expect(anthropic[0]?["content"]?[0]?["cache_control"] == ["type": "ephemeral"])
		let openai = WireFormat.messages([system], modelId: "openai/gpt-5-mini")
		#expect(openai[0]?["content"] == "You are Toby.")
	}

	@Test func encodesImageAndFileParts() {
		let message = Message.user([.text("see"), .image(url: "data:image/png;base64,AA"), .file(filename: "a.pdf", dataURL: "data:application/pdf;base64,BB")])
		let wire = WireFormat.message(for: message, explicitCache: false)
		#expect(wire["content"]?[1]?["image_url"]?["url"] == "data:image/png;base64,AA")
		#expect(wire["content"]?[2]?["file"]?["filename"] == "a.pdf")
	}

	@Test func objectSchemaIsStrict() {
		let schema = JSONSchema.object(["a": .string(), "b": .integer()], optional: ["b"])
		#expect(schema.value["required"] == ["a", "b"])
		#expect(schema.value["additionalProperties"] == false)
		#expect(schema.value["properties"]?["b"]?["type"] == ["integer", "null"])
		#expect(JSONSchema.string(enum: ["x"], nullable: true).value["enum"] == ["x", nil])
	}

	@Test func jsonValueRoundTrips() throws {
		let value: JSONValue = ["n": 3, "f": 1.5, "s": "x", "a": [true, nil], "o": ["k": "v"]]
		#expect(try JSONValue(parsing: value.jsonString()) == value)
		#expect(value.jsonString().contains("\"n\":3"))
	}
}

@Suite("Model catalog")
struct ModelCatalogTests {
	@Test func parsesCapabilitiesAndCaches() async throws {
		let transport = MockTransport([
			.json(200, ["data": [
				[
					"id": "openai/gpt-5-mini", "name": "GPT-5 Mini", "context_length": 400_000,
					"pricing": ["prompt": "0.00000025", "completion": "0.000002"],
					"supported_parameters": ["tools", "structured_outputs", "reasoning"],
					"architecture": ["input_modalities": ["text", "image", "file"]],
				],
				["id": "meta/llama-x", "name": "Llama", "supported_parameters": []],
			]]),
		])
		let catalog = ModelCatalog(client: makeClient(transport, key: nil))
		let models = try await catalog.models()
		#expect(models.count == 2)
		let gpt = try #require(models.first)
		#expect(gpt.supportsTools && gpt.supportsStructuredOutputs && gpt.supportsImages)
		#expect(gpt.promptPrice == 0.00000025)
		#expect(try await catalog.models(for: .structured).map(\.id) == ["openai/gpt-5-mini"])
		#expect(transport.requests.count == 1)
		#expect(transport.requests.first?.httpMethod == "GET")
	}
}

@Suite("OpenRouter sign-in")
struct OpenRouterSignInTests {
	@Test func pkceChallengeMatchesRFC7636Vector() {
		#expect(OpenRouterSignIn.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
	}

	@Test func callbackExchangesCodeForKey() async throws {
		let transport = MockTransport([.json(200, ["key": "sk-or-v1-new"])])
		let signIn = try await OpenRouterSignIn.start(transport: transport)
		let components = try #require(URLComponents(url: signIn.authorizationURL, resolvingAgainstBaseURL: false))
		let callback = try #require(components.queryItems?.first { $0.name == "callback_url" }?.value)
		#expect(components.queryItems?.first { $0.name == "code_challenge_method" }?.value == "S256")
		let path = try #require(URL(string: callback)?.path)

		#expect(signIn.process(requestText: "GET /callback/wrong?code=x HTTP/1.1\r\n\r\n").0 == "404 Not Found")
		#expect(signIn.process(requestText: "GET \(path)?code=abc HTTP/1.1\r\nHost: localhost\r\n\r\n").0 == "200 OK")
		#expect(signIn.process(requestText: "GET \(path)?code=again HTTP/1.1\r\n\r\n").0 == "409 Conflict")

		let key = try await signIn.waitForKey(timeout: .seconds(5))
		#expect(key == "sk-or-v1-new")
		let body = try #require(transport.requestBodies.first)
		#expect(body["code"] == "abc")
		#expect(body["code_challenge_method"] == "S256")
		#expect(body["code_verifier"]?.stringValue?.isEmpty == false)
	}

	@Test func deniedCallbackFails() async throws {
		let signIn = try await OpenRouterSignIn.start(transport: MockTransport([]))
		let callback = URLComponents(url: signIn.authorizationURL, resolvingAgainstBaseURL: false)?
			.queryItems?.first { $0.name == "callback_url" }?.value ?? ""
		let path = URL(string: callback)?.path ?? ""
		_ = signIn.process(requestText: "GET \(path)?error=access_denied HTTP/1.1\r\n\r\n")
		await #expect(throws: AIError.self) {
			try await signIn.waitForKey(timeout: .seconds(5))
		}
	}
}
