import Foundation

/// Errors surfaced by TobyAI. Messages are user-presentable and never contain keys.
public enum AIError: Error, Sendable, Equatable, LocalizedError {
	/// No OpenRouter key is configured.
	case notSignedIn
	/// 401: the key was rejected.
	case unauthorized
	/// 402: the account is out of credits.
	case insufficientCredits(message: String)
	/// 429: rate limited.
	case rateLimited(retryAfterSeconds: Double?)
	/// Any other non-2xx response.
	case http(status: Int, message: String)
	/// An error object delivered inside a stream or response body.
	case provider(message: String, code: Int?)
	/// The response could not be decoded.
	case invalidResponse(String)
	/// Structured output did not match the requested schema.
	case invalidStructuredOutput(raw: String, reason: String)
	case cancelled

	public var errorDescription: String? {
		switch self {
		case .notSignedIn:
			"Sign in with OpenRouter to use Toby's AI features."
		case .unauthorized:
			"OpenRouter rejected the saved key. Sign in again."
		case let .insufficientCredits(message):
			message.isEmpty ? "Your OpenRouter account is out of credits." : message
		case let .rateLimited(retry):
			if let retry { "OpenRouter is rate limiting requests. Try again in \(Int(retry.rounded(.up)))s." } else { "OpenRouter is rate limiting requests. Try again shortly." }
		case let .http(status, message):
			message.isEmpty ? "OpenRouter returned HTTP \(status)." : message
		case let .provider(message, _):
			message
		case let .invalidResponse(detail):
			"Unexpected response from OpenRouter: \(detail)"
		case let .invalidStructuredOutput(_, reason):
			"The model's answer didn't match the expected format: \(reason)"
		case .cancelled:
			"Cancelled."
		}
	}

	/// Map an HTTP failure status + body to an `AIError`.
	static func from(status: Int, body: Data, headers: [AnyHashable: Any]) -> AIError {
		let message = Self.extractMessage(from: body)
		switch status {
		case 401: return .unauthorized
		case 402: return .insufficientCredits(message: message)
		case 429:
			let retry = (headers["Retry-After"] as? String).flatMap(Double.init)
			return .rateLimited(retryAfterSeconds: retry)
		default: return .http(status: status, message: message)
		}
	}

	static func extractMessage(from body: Data) -> String {
		guard let value = try? JSONDecoder().decode(JSONValue.self, from: body) else {
			return String(decoding: body.prefix(500), as: UTF8.self)
		}
		if let message = value["error"]?["message"]?.stringValue { return message }
		if let message = value["error"]?.stringValue { return message }
		if let message = value["message"]?.stringValue { return message }
		return ""
	}
}
