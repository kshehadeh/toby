import Foundation
import TobyAI

/// Converts a persisted Vercel AI SDK `ModelMessage` (one `chat_session_messages`
/// row: `role` + `content_json`) into TobyAI messages.
///
/// One legacy `tool` row can carry several tool results; TobyAI uses one
/// message per result, so a row converts to `[Message]`. Provider-specific
/// payloads (e.g. OpenAI encrypted reasoning) are dropped.
public enum LegacyMessageConverter {
	public static func convert(role: String, contentJSON: String) -> [Message] {
		let content = (try? JSONValue(parsing: contentJSON)) ?? .string(contentJSON)
		switch role {
		case "system":
			return [.system(text(of: content))]
		case "user":
			return [convertUser(content)]
		case "assistant":
			return [convertAssistant(content)]
		case "tool":
			return convertToolResults(content)
		default:
			return []
		}
	}

	// MARK: Roles

	static func convertUser(_ content: JSONValue) -> Message {
		guard case let .array(parts) = content else { return .user(text(of: content)) }
		var converted: [ContentPart] = []
		for part in parts {
			switch part["type"]?.stringValue {
			case "text":
				if let text = part["text"]?.stringValue { converted.append(.text(text)) }
			case "image":
				let mediaType = part["mediaType"]?.stringValue ?? part["mimeType"]?.stringValue ?? "image/png"
				if let source = part["image"]?.stringValue ?? part["url"]?.stringValue {
					converted.append(.image(url: dataURL(source, mediaType: mediaType)))
				}
			case "file":
				let mediaType = part["mediaType"]?.stringValue ?? part["mimeType"]?.stringValue ?? "application/octet-stream"
				let filename = part["filename"]?.stringValue ?? "attachment"
				if let source = part["data"]?.stringValue ?? part["url"]?.stringValue {
					if mediaType.hasPrefix("image/") {
						converted.append(.image(url: dataURL(source, mediaType: mediaType)))
					} else {
						converted.append(.file(filename: filename, dataURL: dataURL(source, mediaType: mediaType)))
					}
				}
			default:
				continue
			}
		}
		return .user(converted)
	}

	static func convertAssistant(_ content: JSONValue) -> Message {
		guard case let .array(parts) = content else { return .assistant(text(of: content)) }
		var text = ""
		var reasoning = ""
		var calls: [ToolCall] = []
		for part in parts {
			switch part["type"]?.stringValue {
			case "text":
				text += part["text"]?.stringValue ?? ""
			case "reasoning":
				reasoning += part["text"]?.stringValue ?? ""
			case "tool-call":
				guard let id = part["toolCallId"]?.stringValue, let name = part["toolName"]?.stringValue else { continue }
				let input = part["input"] ?? part["args"] ?? .object([:])
				let arguments = input.stringValue ?? input.jsonString()
				calls.append(ToolCall(id: id, name: name, arguments: arguments))
			default:
				continue
			}
		}
		return .assistant(text, toolCalls: calls, reasoning: reasoning.isEmpty ? nil : reasoning)
	}

	static func convertToolResults(_ content: JSONValue) -> [Message] {
		guard case let .array(parts) = content else { return [] }
		return parts.compactMap { part in
			guard part["type"]?.stringValue == "tool-result",
			      let id = part["toolCallId"]?.stringValue
			else { return nil }
			let name = part["toolName"]?.stringValue ?? ""
			return .tool(callId: id, name: name, result: toolOutput(part))
		}
	}

	/// AI SDK v5+ `output: {type, value}`; older rows use `result`.
	static func toolOutput(_ part: JSONValue) -> JSONValue {
		guard let output = part["output"] else { return part["result"] ?? .null }
		let value = output["value"] ?? .null
		switch output["type"]?.stringValue {
		case "json", "text": return value
		case "error-text", "error-json": return ["error": value]
		case "content":
			let texts = (value.arrayValue ?? []).compactMap { $0["text"]?.stringValue }
			return .string(texts.joined(separator: "\n"))
		default: return value
		}
	}

	// MARK: Helpers

	static func text(of content: JSONValue) -> String {
		if let text = content.stringValue { return text }
		return (content.arrayValue ?? []).compactMap { part in
			part["type"]?.stringValue == "text" ? part["text"]?.stringValue : nil
		}.joined()
	}

	/// URLs pass through; bare base64 becomes a `data:` URL.
	static func dataURL(_ source: String, mediaType: String) -> String {
		if source.hasPrefix("data:") || source.hasPrefix("http://") || source.hasPrefix("https://") {
			return source
		}
		return "data:\(mediaType);base64,\(source)"
	}
}
