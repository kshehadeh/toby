import Foundation

/// Converts TobyAI types to/from the OpenAI-compatible chat-completions wire
/// format that OpenRouter speaks.
enum WireFormat {
	// MARK: Encoding

	static func messages(_ messages: [Message], modelId: String) -> JSONValue {
		let caching = PromptCaching.usesExplicitBreakpoints(modelId: modelId)
		return .array(messages.map { message(for: $0, explicitCache: caching) })
	}

	static func message(for message: Message, explicitCache: Bool) -> JSONValue {
		var dict: [String: JSONValue] = ["role": .string(message.role.rawValue)]
		let wantsCache = explicitCache && message.cacheBreakpoint

		switch message.role {
		case .tool:
			dict["tool_call_id"] = .string(message.toolCallId ?? "")
			dict["content"] = .string(message.text)
		case .assistant:
			let text = message.text
			dict["content"] = text.isEmpty && !message.toolCalls.isEmpty ? .null : .string(text)
			if !message.toolCalls.isEmpty {
				dict["tool_calls"] = .array(message.toolCalls.map { call in
					[
						"id": .string(call.id),
						"type": "function",
						"function": [
							"name": .string(call.name),
							"arguments": .string(call.arguments.isEmpty ? "{}" : call.arguments),
						],
					]
				})
			}
		case .system, .user:
			let onlyText = message.content.allSatisfy { if case .text = $0 { true } else { false } }
			if onlyText, !wantsCache {
				dict["content"] = .string(message.text)
			} else {
				var parts = message.content.map(contentPart)
				if wantsCache, let lastIndex = parts.lastIndex(where: { $0["type"] == "text" }),
				   case var .object(last) = parts[lastIndex]
				{
					last["cache_control"] = ["type": "ephemeral"]
					parts[lastIndex] = .object(last)
				}
				dict["content"] = .array(parts)
			}
		}
		return .object(dict)
	}

	static func contentPart(_ part: ContentPart) -> JSONValue {
		switch part {
		case let .text(text):
			["type": "text", "text": .string(text)]
		case let .image(url):
			["type": "image_url", "image_url": ["url": .string(url)]]
		case let .file(filename, dataURL):
			["type": "file", "file": ["filename": .string(filename), "file_data": .string(dataURL)]]
		}
	}

	static func tools(_ tools: [Tool]) -> JSONValue {
		.array(tools.map { tool in
			[
				"type": "function",
				"function": [
					"name": .string(tool.name),
					"description": .string(tool.description),
					"parameters": tool.parameters.value,
				],
			]
		})
	}

	// MARK: Decoding

	static func usage(from value: JSONValue?) -> Usage? {
		guard let value, case .object = value else { return nil }
		let details = value["prompt_tokens_details"]
		let completionDetails = value["completion_tokens_details"]
		return Usage(
			inputTokens: value["prompt_tokens"]?.intValue ?? 0,
			outputTokens: value["completion_tokens"]?.intValue ?? 0,
			cacheReadTokens: details?["cached_tokens"]?.intValue,
			cacheWriteTokens: details?["cache_write_tokens"]?.intValue,
			reasoningTokens: completionDetails?["reasoning_tokens"]?.intValue,
			cost: value["cost"]?.doubleValue,
		)
	}

	static func finishReason(_ raw: String?) -> FinishReason {
		switch raw {
		case "stop": .stop
		case "length": .length
		case "tool_calls", "function_call": .toolCalls
		case "content_filter": .contentFilter
		case "error": .error
		case nil: .unknown
		default: .other(raw ?? "")
		}
	}
}

public enum FinishReason: Sendable, Hashable {
	case stop
	case length
	case toolCalls
	case contentFilter
	case error
	case unknown
	case other(String)
}

/// Prompt-cache hints. OpenAI, DeepSeek, Grok etc. cache automatically on
/// OpenRouter; Anthropic and Gemini need explicit `cache_control` breakpoints.
public enum PromptCaching {
	public static func usesExplicitBreakpoints(modelId: String) -> Bool {
		let upstream = modelId.split(separator: "/").first.map(String.init) ?? ""
		return upstream == "anthropic" || upstream == "google"
	}
}
