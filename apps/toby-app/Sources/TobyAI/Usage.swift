import Foundation

/// Token usage (and OpenRouter-reported cost) for one or more model calls.
public struct Usage: Sendable, Hashable, Codable {
	public var inputTokens: Int
	public var outputTokens: Int
	public var cacheReadTokens: Int?
	public var cacheWriteTokens: Int?
	public var reasoningTokens: Int?
	/// Cost in credits (USD) as reported by OpenRouter usage accounting.
	public var cost: Double?

	public init(
		inputTokens: Int = 0,
		outputTokens: Int = 0,
		cacheReadTokens: Int? = nil,
		cacheWriteTokens: Int? = nil,
		reasoningTokens: Int? = nil,
		cost: Double? = nil,
	) {
		self.inputTokens = inputTokens
		self.outputTokens = outputTokens
		self.cacheReadTokens = cacheReadTokens
		self.cacheWriteTokens = cacheWriteTokens
		self.reasoningTokens = reasoningTokens
		self.cost = cost
	}

	public var totalTokens: Int { inputTokens + outputTokens }

	public static let zero = Usage()

	public static func + (lhs: Usage, rhs: Usage) -> Usage {
		Usage(
			inputTokens: lhs.inputTokens + rhs.inputTokens,
			outputTokens: lhs.outputTokens + rhs.outputTokens,
			cacheReadTokens: sum(lhs.cacheReadTokens, rhs.cacheReadTokens),
			cacheWriteTokens: sum(lhs.cacheWriteTokens, rhs.cacheWriteTokens),
			reasoningTokens: sum(lhs.reasoningTokens, rhs.reasoningTokens),
			cost: sum(lhs.cost, rhs.cost),
		)
	}

	private static func sum<T: AdditiveArithmetic>(_ a: T?, _ b: T?) -> T? {
		switch (a, b) {
		case (nil, nil): nil
		case let (x?, nil): x
		case let (nil, y?): y
		case let (x?, y?): x + y
		}
	}
}
