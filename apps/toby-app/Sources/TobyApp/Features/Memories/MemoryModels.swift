import Foundation

struct MemoryItem: Decodable, Identifiable, Equatable {
	let id: String
	let userId: String
	let type: String
	let subject: String?
	let value: String
	let confidence: Double
	let sensitivity: String
	let visibility: String
	let sourceIds: [String]?
	let createdAt: String
	let updatedAt: String
	let expiresAt: String?

	private enum CodingKeys: String, CodingKey {
		case id, userId, type, subject, value, confidence, sensitivity, visibility
		case sourceIds, createdAt, updatedAt, expiresAt
	}

	init(
		id: String,
		userId: String,
		type: String,
		subject: String? = nil,
		value: String,
		confidence: Double = 1,
		sensitivity: String = "normal",
		visibility: String = "usable_by_ai",
		sourceIds: [String]? = nil,
		createdAt: String,
		updatedAt: String,
		expiresAt: String? = nil
	) {
		self.id = id
		self.userId = userId
		self.type = type
		self.subject = subject
		self.value = value
		self.confidence = confidence
		self.sensitivity = sensitivity
		self.visibility = visibility
		self.sourceIds = sourceIds
		self.createdAt = createdAt
		self.updatedAt = updatedAt
		self.expiresAt = expiresAt
	}

	init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		id = try c.decode(String.self, forKey: .id)
		userId = try c.decode(String.self, forKey: .userId)
		type = try c.decode(String.self, forKey: .type)
		subject = try c.decodeIfPresent(String.self, forKey: .subject)
		value = try c.decode(String.self, forKey: .value)
		confidence = try c.decodeIfPresent(Double.self, forKey: .confidence) ?? 1
		sensitivity = try c.decodeIfPresent(String.self, forKey: .sensitivity) ?? "normal"
		visibility = try c.decodeIfPresent(String.self, forKey: .visibility) ?? "usable_by_ai"
		sourceIds = try c.decodeIfPresent([String].self, forKey: .sourceIds)
		createdAt = try c.decode(String.self, forKey: .createdAt)
		updatedAt = try c.decode(String.self, forKey: .updatedAt)
		expiresAt = try c.decodeIfPresent(String.self, forKey: .expiresAt)
	}
}

struct MemoriesListResponse: Decodable {
	let memories: [MemoryItem]
	let limit: Int?
	let offset: Int?
	let total: Int?
	let hasMore: Bool?
}

struct MemoryDetailResponse: Decodable {
	let memory: MemoryItem
}

struct MemoryCreateRequest: Encodable {
	let type: String
	let subject: String?
	let value: String
	let confidence: Double?
	let sensitivity: String?
	let visibility: String?
	let expiresAt: String?

	init(
		type: String = "fact",
		subject: String? = nil,
		value: String,
		confidence: Double? = nil,
		sensitivity: String? = nil,
		visibility: String? = nil,
		expiresAt: String? = nil
	) {
		self.type = type
		self.subject = subject?.isEmpty == true ? nil : subject
		self.value = value
		self.confidence = confidence
		self.sensitivity = sensitivity
		self.visibility = visibility
		self.expiresAt = expiresAt
	}
}

struct MemoryPatchRequest: Encodable {
	let type: String?
	let subject: String?
	let value: String?
	let confidence: Double?
	let sensitivity: String?
	let visibility: String?
	let expiresAt: String?

	init(
		type: String? = nil,
		subject: String? = nil,
		value: String? = nil,
		confidence: Double? = nil,
		sensitivity: String? = nil,
		visibility: String? = nil,
		expiresAt: String? = nil
	) {
		self.type = type
		self.subject = subject
		self.value = value
		self.confidence = confidence
		self.sensitivity = sensitivity
		self.visibility = visibility
		self.expiresAt = expiresAt
	}
}

enum MemoryField: String, CaseIterable, Identifiable {
	case type, subject, value, confidence, sensitivity, visibility, expiresAt
	var id: String { rawValue }

	var label: String {
		switch self {
		case .type: "Type"
		case .subject: "Subject"
		case .value: "Value"
		case .confidence: "Confidence"
		case .sensitivity: "Sensitivity"
		case .visibility: "Visibility"
		case .expiresAt: "Expires At"
		}
	}
}

extension MemoryField {
	static let memoryTypes: [String] = [
		"preference", "relationship", "project", "life_event", "fact", "summary",
	]
	static let memorySensitivities: [String] = ["normal", "sensitive", "restricted"]
	static let memoryVisibilities: [String] = [
		"usable_by_ai", "requires_confirmation", "private",
	]
}
