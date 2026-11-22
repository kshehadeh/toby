import Foundation
import TobyAI

/// Scripted `HTTPTransport`: returns queued responses in order and records requests.
final class MockTransport: HTTPTransport, @unchecked Sendable {
	enum Reply {
		case json(Int, JSONValue)
		case sse([String])
		case status(Int, String, headers: [String: String] = [:])
	}

	private let lock = NSLock()
	private var replies: [Reply]
	private(set) var requests: [URLRequest] = []

	init(_ replies: [Reply]) {
		self.replies = replies
	}

	var requestBodies: [JSONValue] {
		lock.withLock {
			requests.compactMap { request in
				request.httpBody.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
			}
		}
	}

	private func next(_ request: URLRequest) -> Reply {
		lock.withLock {
			requests.append(request)
			precondition(!replies.isEmpty, "MockTransport: no reply queued for \(request.url?.absoluteString ?? "")")
			return replies.removeFirst()
		}
	}

	private func response(_ request: URLRequest, status: Int, headers: [String: String] = [:]) -> HTTPURLResponse {
		HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
	}

	func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
		switch next(request) {
		case let .json(status, value):
			return (try JSONEncoder().encode(value), response(request, status: status))
		case let .status(status, body, headers):
			return (Data(body.utf8), response(request, status: status, headers: headers))
		case .sse:
			fatalError("SSE reply queued for non-streaming request")
		}
	}

	func streamLines(_ request: URLRequest) async throws -> StreamedResponse {
		switch next(request) {
		case let .sse(lines):
			let stream = AsyncThrowingStream<String, Error> { continuation in
				for line in lines { continuation.yield(line) }
				continuation.finish()
			}
			return StreamedResponse(response: response(request, status: 200), lines: stream)
		case let .status(status, body, headers):
			return StreamedResponse(
				response: response(request, status: status, headers: headers),
				lines: AsyncThrowingStream { $0.finish() },
				errorBody: Data(body.utf8),
			)
		case let .json(status, value):
			return StreamedResponse(
				response: response(request, status: status),
				lines: AsyncThrowingStream { $0.finish() },
				errorBody: try JSONEncoder().encode(value),
			)
		}
	}
}

/// SSE line helpers for chat-completion chunks.
enum Chunks {
	static func line(_ value: JSONValue) -> String { "data: \(value.jsonString())" }

	static func text(_ text: String) -> String {
		line(["choices": [["index": 0, "delta": ["content": .string(text)]]]])
	}

	static func toolCall(index: Int, id: String? = nil, name: String? = nil, arguments: String) -> String {
		var function: [String: JSONValue] = ["arguments": .string(arguments)]
		if let name { function["name"] = .string(name) }
		var call: [String: JSONValue] = ["index": .number(Double(index)), "function": .object(function)]
		if let id { call["id"] = .string(id); call["type"] = "function" }
		return line(["choices": [["index": 0, "delta": ["tool_calls": [.object(call)]]]]])
	}

	static func finish(_ reason: String, prompt: Int = 10, completion: Int = 5, cached: Int? = nil) -> [String] {
		var usage: [String: JSONValue] = [
			"prompt_tokens": .number(Double(prompt)),
			"completion_tokens": .number(Double(completion)),
			"cost": 0.001,
		]
		if let cached { usage["prompt_tokens_details"] = ["cached_tokens": .number(Double(cached))] }
		return [
			line(["choices": [["index": 0, "delta": [:], "finish_reason": .string(reason)]]]),
			line(["choices": [], "usage": .object(usage)]),
			"data: [DONE]",
		]
	}
}

func makeClient(_ transport: MockTransport, key: String? = "sk-or-test") -> OpenRouterClient {
	OpenRouterClient(keyProvider: StaticAPIKey(key), transport: transport)
}
