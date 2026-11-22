import Foundation

struct FollowupsSettingsResponse: Decodable {
	let followups: FollowupsSettingsConfig
}

struct FollowupsRunResult: Decodable, Equatable {
	let status: String
	let ingested: Int
	let enriched: Int
	let reconciled: Int
	let candidates: Int
	let evaluated: Int
	let opened: Int
	let closed: Int
	let error: String?
}

struct FollowupsSettingsConfig: Codable, Equatable {
	var enabled = true
	var evaluator: FollowupsEvaluatorPreference?
	var sources: [String: Bool] = [:]
	var kinds = FollowupsKinds()
	var awaitingReplyDays = 3
	var thresholds = FollowupsThresholds()
	var autoComplete = true
	var notifications = true
	var intervalMinutes = 30
	var maxEvaluationsPerDay = 200

	init() {}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
		evaluator = try container.decodeIfPresent(FollowupsEvaluatorPreference.self, forKey: .evaluator)
		sources = try container.decodeIfPresent([String: Bool].self, forKey: .sources) ?? [:]
		kinds = try container.decodeIfPresent(FollowupsKinds.self, forKey: .kinds) ?? FollowupsKinds()
		awaitingReplyDays = try container.decodeIfPresent(Int.self, forKey: .awaitingReplyDays) ?? 3
		thresholds = try container.decodeIfPresent(FollowupsThresholds.self, forKey: .thresholds) ?? FollowupsThresholds()
		autoComplete = try container.decodeIfPresent(Bool.self, forKey: .autoComplete) ?? true
		notifications = try container.decodeIfPresent(Bool.self, forKey: .notifications) ?? true
		intervalMinutes = try container.decodeIfPresent(Int.self, forKey: .intervalMinutes) ?? 30
		maxEvaluationsPerDay = try container.decodeIfPresent(Int.self, forKey: .maxEvaluationsPerDay) ?? 200
	}

	func requestBody(sourceDefaults: [String: Bool]) -> [String: Any] {
		let sourceOverrides = sources.filter { sourceDefaults[$0.key] != $0.value }
		let enabledKinds: [String: Bool] = [
			"oweReply": kinds.oweReply,
			"awaitingReply": kinds.awaitingReply,
			"commitment": kinds.commitment,
		]
		return [
			"followups": [
				"enabled": enabled,
				"evaluator": [
					"provider": evaluator?.provider as Any? ?? NSNull(),
					"model": evaluator?.model as Any? ?? NSNull(),
				],
				"sources": sourceOverrides,
				"kinds": enabledKinds,
				"awaitingReplyDays": awaitingReplyDays,
				"thresholds": ["open": thresholds.open, "close": thresholds.close],
				"autoComplete": autoComplete,
				"notifications": notifications,
				"intervalMinutes": intervalMinutes,
				"maxEvaluationsPerDay": maxEvaluationsPerDay,
			],
		]
	}
}

struct FollowupsEvaluatorPreference: Codable, Equatable {
	var provider: String?
	var model: String?
}

struct FollowupsKinds: Codable, Equatable {
	var oweReply = true
	var awaitingReply = true
	var commitment = true

	init() {}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		oweReply = try container.decodeIfPresent(Bool.self, forKey: .oweReply) ?? true
		awaitingReply = try container.decodeIfPresent(Bool.self, forKey: .awaitingReply) ?? true
		commitment = try container.decodeIfPresent(Bool.self, forKey: .commitment) ?? true
	}
}

struct FollowupsThresholds: Codable, Equatable {
	var open = 0.75
	var close = 0.85

	init() {}

	init(from decoder: Decoder) throws {
		let container = try decoder.container(keyedBy: CodingKeys.self)
		open = try container.decodeIfPresent(Double.self, forKey: .open) ?? 0.75
		close = try container.decodeIfPresent(Double.self, forKey: .close) ?? 0.85
	}
}

struct FollowupSource: Decodable, Identifiable, Equatable {
	var id: String
	var displayName: String
	var origin: String
	var evidenceOnly: Bool
	var enabled: Bool
	var defaultEnabled: Bool?
	var cursor: FollowupSourceCursor?
}

struct FollowupSourceCursor: Decodable, Equatable {
	var lastError: String?
	var lastSuccessAt: String?
	var ingestedCount: Int?
}

struct FollowupInstruction: Decodable, Identifiable, Equatable {
	var id: String
	var text: String
	var updatedAt: String?
}

struct FollowupInstructionListResponse: Decodable {
	var instructions: [FollowupInstruction]
}

struct FollowupDetail: Decodable, Equatable {
	var loopId: String
	var kind: String
	var status: String
	var fingerprint: String
	var title: String
	var counterpart: String?
	var dueAt: String?
	var confidence: Double
	var todoId: String?
	var resolutionRejected: Bool
	var reopenedAt: String?
	var lastActivityAt: String
	var createdAt: String
	var updatedAt: String
	var evidence: [FollowupEvidence]
}

struct FollowupEvidence: Decodable, Identifiable, Equatable {
	var id: String
	var reason: String
	var title: String
	var occurredAt: String
	var url: String?
}
