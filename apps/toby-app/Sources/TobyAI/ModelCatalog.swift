import Foundation

/// A model listed by OpenRouter's `/models` endpoint.
public struct ModelInfo: Sendable, Hashable, Identifiable {
	public var id: String
	public var name: String
	public var contextLength: Int?
	/// USD per token.
	public var promptPrice: Double?
	public var completionPrice: Double?
	public var supportedParameters: Set<String>
	public var inputModalities: Set<String>

	public var supportsTools: Bool { supportedParameters.contains("tools") }
	public var supportsStructuredOutputs: Bool { supportedParameters.contains("structured_outputs") }
	public var supportsReasoning: Bool { supportedParameters.contains("reasoning") }
	public var supportsImages: Bool { inputModalities.contains("image") }
	public var supportsFiles: Bool { inputModalities.contains("file") }
}

/// Fetches and caches the OpenRouter model list.
public actor ModelCatalog {
	private let client: OpenRouterClient
	private let ttl: Duration
	private var cached: (models: [ModelInfo], at: ContinuousClock.Instant)?

	public init(client: OpenRouterClient, ttl: Duration = .seconds(3600)) {
		self.client = client
		self.ttl = ttl
	}

	public func models(forceRefresh: Bool = false) async throws -> [ModelInfo] {
		if !forceRefresh, let cached, ContinuousClock.now - cached.at < ttl {
			return cached.models
		}
		let response = try await client.json(path: "models", method: "GET", requiresKey: false)
		let models = (response["data"]?.arrayValue ?? []).compactMap(Self.parse)
		cached = (models, .now)
		return models
	}

	public func model(_ id: String) async throws -> ModelInfo? {
		try await models().first { $0.id == id }
	}

	/// Models suitable for a role, for the Advanced picker.
	public func models(for role: ModelRole) async throws -> [ModelInfo] {
		try await models().filter { role.isSatisfied(by: $0) }
	}

	static func parse(_ value: JSONValue) -> ModelInfo? {
		guard let id = value["id"]?.stringValue else { return nil }
		let pricing = value["pricing"]
		return ModelInfo(
			id: id,
			name: value["name"]?.stringValue ?? id,
			contextLength: value["context_length"]?.intValue,
			promptPrice: pricing?["prompt"]?.stringValue.flatMap(Double.init),
			completionPrice: pricing?["completion"]?.stringValue.flatMap(Double.init),
			supportedParameters: Set((value["supported_parameters"]?.arrayValue ?? []).compactMap(\.stringValue)),
			inputModalities: Set((value["architecture"]?["input_modalities"]?.arrayValue ?? []).compactMap(\.stringValue)),
		)
	}
}

/// What a model is used for. Each role has a curated default so a new user
/// never has to choose a model.
public enum ModelRole: String, Sendable, CaseIterable, Codable {
	/// Conversations (user-selectable under Advanced, or per persona).
	case chat
	/// Cheap, quick calls: titles, routing deltas, cron parsing, planning.
	case fast
	/// Background structured-output work: Feed ranking, follow-ups, graph extraction.
	case structured

	public var defaultModelId: String {
		switch self {
		case .chat: ModelDefaults.chat
		case .fast: ModelDefaults.fast
		case .structured: ModelDefaults.structured
		}
	}

	public func isSatisfied(by model: ModelInfo) -> Bool {
		switch self {
		case .chat: model.supportsTools
		case .fast: true
		case .structured: model.supportsStructuredOutputs
		}
	}
}

/// Curated defaults (OpenRouter slugs).
public enum ModelDefaults {
	public static let chat = "openai/gpt-5-mini"
	public static let fast = "openai/gpt-5.6-luna"
	public static let structured = "openai/gpt-5-mini"
	/// Same model the TS daemon used, so imported vectors remain comparable.
	public static let embedding = "openai/text-embedding-3-small"
}
