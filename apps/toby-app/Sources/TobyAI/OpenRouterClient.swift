import Foundation

/// Supplies the OpenRouter API key on demand (Keychain in the app, static in tests).
public protocol APIKeyProvider: Sendable {
	func apiKey() async throws -> String?
}

public struct StaticAPIKey: APIKeyProvider {
	private let key: String?
	public init(_ key: String?) { self.key = key }
	public func apiKey() async throws -> String? { key }
}

public struct OpenRouterConfiguration: Sendable {
	public var baseURL: URL
	/// Attribution headers (https://openrouter.ai/docs/app-attribution).
	public var appReferer: String
	public var appTitle: String
	public var requestTimeout: TimeInterval

	public init(
		baseURL: URL = URL(string: "https://openrouter.ai/api/v1")!,
		appReferer: String = "https://www.tobyai.app",
		appTitle: String = "Toby",
		requestTimeout: TimeInterval = 180,
	) {
		self.baseURL = baseURL
		self.appReferer = appReferer
		self.appTitle = appTitle
		self.requestTimeout = requestTimeout
	}
}

/// Low-level OpenRouter HTTP client. Higher-level APIs (`streamText`,
/// `generateObject`, `embed`, `ModelCatalog`) are built on it.
public struct OpenRouterClient: Sendable {
	public let configuration: OpenRouterConfiguration
	let keyProvider: any APIKeyProvider
	let transport: any HTTPTransport

	public init(
		keyProvider: any APIKeyProvider,
		configuration: OpenRouterConfiguration = OpenRouterConfiguration(),
		transport: any HTTPTransport = URLSessionTransport(),
	) {
		self.keyProvider = keyProvider
		self.configuration = configuration
		self.transport = transport
	}

	/// A chat model handle, e.g. `client.model("openai/gpt-5-mini")`.
	public func model(_ id: String) -> LanguageModel {
		LanguageModel(id: id, client: self)
	}

	public func embeddingModel(_ id: String = ModelDefaults.embedding) -> EmbeddingModel {
		EmbeddingModel(id: id, client: self)
	}

	// MARK: Requests

	func makeRequest(path: String, method: String = "POST", body: JSONValue? = nil, requiresKey: Bool = true) async throws -> URLRequest {
		var request = URLRequest(url: configuration.baseURL.appending(path: path))
		request.httpMethod = method
		request.timeoutInterval = configuration.requestTimeout
		request.setValue(configuration.appReferer, forHTTPHeaderField: "HTTP-Referer")
		request.setValue(configuration.appTitle, forHTTPHeaderField: "X-Title")
		if let key = try await keyProvider.apiKey(), !key.isEmpty {
			request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
		} else if requiresKey {
			throw AIError.notSignedIn
		}
		if let body {
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
			request.httpBody = try JSONEncoder.toby.encode(body)
		}
		return request
	}

	/// POST/GET returning decoded JSON, mapping failures to `AIError`.
	func json(path: String, method: String = "POST", body: JSONValue? = nil, requiresKey: Bool = true) async throws -> JSONValue {
		let request = try await makeRequest(path: path, method: method, body: body, requiresKey: requiresKey)
		let (data, response) = try await transport.send(request)
		guard (200 ..< 300).contains(response.statusCode) else {
			throw AIError.from(status: response.statusCode, body: data, headers: response.allHeaderFields)
		}
		let value: JSONValue
		do {
			value = try JSONDecoder().decode(JSONValue.self, from: data)
		} catch {
			throw AIError.invalidResponse("body was not JSON")
		}
		if let error = value["error"], !error.isNull {
			throw AIError.provider(
				message: error["message"]?.stringValue ?? "OpenRouter returned an error.",
				code: error["code"]?.intValue,
			)
		}
		return value
	}

	/// POST a streaming request and return its SSE `data:` payloads.
	func sse(path: String, body: JSONValue) async throws -> AsyncThrowingStream<JSONValue, Error> {
		let request = try await makeRequest(path: path, body: body)
		let streamed = try await transport.streamLines(request)
		guard (200 ..< 300).contains(streamed.response.statusCode) else {
			throw AIError.from(
				status: streamed.response.statusCode,
				body: streamed.errorBody,
				headers: streamed.response.allHeaderFields,
			)
		}
		return SSEDecoder.events(from: streamed.lines)
	}

	// MARK: Account

	/// Key metadata: label, usage, limit (`GET /key`). Used to verify a key.
	public func keyInfo() async throws -> KeyInfo {
		let value = try await json(path: "key", method: "GET")
		let data = value["data"] ?? value
		return KeyInfo(
			label: data["label"]?.stringValue,
			usage: data["usage"]?.doubleValue ?? 0,
			limit: data["limit"]?.doubleValue,
			limitRemaining: data["limit_remaining"]?.doubleValue,
			isFreeTier: data["is_free_tier"]?.boolValue ?? false,
		)
	}

	/// Account credit balance (`GET /credits`).
	public func credits() async throws -> Credits {
		let value = try await json(path: "credits", method: "GET")
		let data = value["data"] ?? value
		return Credits(
			totalCredits: data["total_credits"]?.doubleValue ?? 0,
			totalUsage: data["total_usage"]?.doubleValue ?? 0,
		)
	}
}

public struct KeyInfo: Sendable, Hashable {
	public var label: String?
	public var usage: Double
	public var limit: Double?
	public var limitRemaining: Double?
	public var isFreeTier: Bool
}

public struct Credits: Sendable, Hashable {
	public var totalCredits: Double
	public var totalUsage: Double
	public var remaining: Double { max(0, totalCredits - totalUsage) }
}

/// A chat model on OpenRouter.
public struct LanguageModel: Sendable {
	public let id: String
	public let client: OpenRouterClient

	public init(id: String, client: OpenRouterClient) {
		self.id = id
		self.client = client
	}
}

/// An embedding model on OpenRouter.
public struct EmbeddingModel: Sendable {
	public let id: String
	public let client: OpenRouterClient
}
