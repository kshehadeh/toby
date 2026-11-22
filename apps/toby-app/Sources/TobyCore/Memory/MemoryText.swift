import CryptoKit
import Foundation

/// A stored memory (row of `memory_items` plus derived fields).
public struct MemoryRecord: Sendable, Hashable {
	public var id: String
	public var userID: String
	public var type: String
	public var subject: String?
	public var value: String
	public var confidence: Double
	public var sensitivity: String
	public var visibility: String
	public var sourceIDs: [String]
	public var createdAt: String
	public var updatedAt: String
	public var expiresAt: String?
	public var embeddingModel: String?
}

/// Text normalization, hashing, keywords, and ranking (ports of
/// `memory/text.ts` and `memory/keywords.ts`).
public enum MemoryText {
	public static let types = ["preference", "relationship", "project", "life_event", "fact", "summary"]
	public static let sensitivities = ["normal", "sensitive", "restricted"]
	public static let visibilities = ["usable_by_ai", "requires_confirmation", "private"]

	static func collapseWhitespace(_ text: String) -> String {
		text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
	}

	public static func normalize(_ value: String, subject: String?) -> String {
		let subj = (subject ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		let body = collapseWhitespace(value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
		return "\(subj)\n\(body)"
	}

	/// SHA-256 of the normalized text, for exact dedup (same as the daemon).
	public static func contentHash(_ value: String, subject: String?) -> String {
		SHA256.hash(data: Data(normalize(value, subject: subject).utf8)).map { String(format: "%02x", $0) }.joined()
	}

	public static func embedText(value: String, subject: String?) -> String {
		let subj = subject?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let body = value.trimmingCharacters(in: .whitespacesAndNewlines)
		return subj.isEmpty ? body : "\(subj)\n\(body)"
	}

	/// `next` is a longer restatement that contains `previous`.
	public static func isMoreSpecific(_ next: String, than previous: String) -> Bool {
		let n = next.trimmingCharacters(in: .whitespacesAndNewlines)
		let p = previous.trimmingCharacters(in: .whitespacesAndNewlines)
		return n.count > p.count && n.lowercased().contains(p.lowercased())
	}

	/// Escape `%`, `_`, `!` for `LIKE … ESCAPE '!'`.
	public static func escapeLike(_ raw: String) -> String {
		var out = ""
		for character in raw {
			if "!%_".contains(character) { out.append("!") }
			out.append(character)
		}
		return out
	}

	static let stopWords: Set<String> = [
		"a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
		"will", "would", "could", "should", "may", "might", "can", "shall", "to", "of", "in", "for", "on", "with", "at",
		"by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "out", "off",
		"over", "under", "again", "further", "then", "once", "and", "but", "or", "nor", "not", "so", "if", "this", "that",
		"these", "those", "i", "me", "my", "we", "our", "you", "your", "it", "its", "he", "she", "they", "them", "what",
		"which", "who", "when", "where", "how", "all", "each", "every", "both", "few", "more", "most", "other", "some",
		"such", "no", "only", "own", "same", "than", "too", "very", "just", "also", "about", "up",
	]

	/// JS: lowercase, `[^\w\s]` → space, split, drop short words and stop words.
	public static func keywords(_ text: String) -> [String] {
		let cleaned = String(text.lowercased().map { character -> Character in
			character.isASCII && (character.isLetter || character.isNumber || character == "_") || character.isWhitespace ? character : " "
		})
		return cleaned.split(whereSeparator: \.isWhitespace).map(String.init).filter { $0.count > 2 && !stopWords.contains($0) }
	}

	static func score(_ item: MemoryRecord, query: String, keywords: [String]) -> Double {
		let haystack = "\(item.value) \(item.subject ?? "") \(item.type)".lowercased()
		let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		var score = item.confidence
		if !q.isEmpty, haystack.contains(q) { score += 10 }
		for keyword in keywords where haystack.contains(keyword) { score += 2 }
		return score
	}

	/// Semantic score first (when given), then keyword/confidence, then recency.
	static func rank(_ items: [MemoryRecord], query: String, keywords: [String], semantic: [String: Float] = [:]) -> [MemoryRecord] {
		items.sorted { a, b in
			let sa = semantic[a.id] ?? 0
			let sb = semantic[b.id] ?? 0
			if sa != sb { return sa > sb }
			let delta = score(b, query: query, keywords: keywords) - score(a, query: query, keywords: keywords)
			if delta != 0 { return delta < 0 }
			return a.updatedAt > b.updatedAt
		}
	}
}

/// Sensitivity / visibility policy for proposals (port of `memory/policy.ts`).
public enum MemoryPolicy {
	static let restricted = [
		"health", "medical", "diagnosis", "medication", "prescription", "mental health", "depression", "anxiety", "therapy",
		"psychiatrist", "political", "political affiliation", "republican", "democrat", "religion", "religious", "church",
		"mosque", "temple", "prayer", "sexuality", "sexual orientation", "lgbt", "gender identity", "location", "home address",
		"residence", "financial", "salary", "income", "bank account", "credit card", "debt", "ssn", "social security",
		"family-sensitive", "divorce", "custody", "abuse",
	]
	static let sensitive = ["personal", "private", "secret", "intimate", "partner", "spouse", "married", "children", "kids", "password", "authentication"]
	static let explicitPatterns = [
		"i prefer", "i like", "i want", "i need", "i always", "i never", "i am", "i'm", "my name is", "my preference",
		"please remember", "don't forget", "note that i",
	]

	public static func classifySensitivity(type: String, subject: String?, value: String) -> String {
		let text = [value, subject ?? "", type].joined(separator: " ").lowercased()
		if restricted.contains(where: text.contains) { return "restricted" }
		if sensitive.contains(where: text.contains) { return "sensitive" }
		return "normal"
	}

	public static func isExplicit(_ value: String) -> Bool {
		let lower = value.lowercased()
		return explicitPatterns.contains(where: lower.contains)
	}

	public static func suggestVisibility(sensitivity: String, type: String, explicit: Bool) -> String {
		if sensitivity == "restricted" || sensitivity == "sensitive" { return "requires_confirmation" }
		if type == "relationship", !explicit { return "requires_confirmation" }
		return "usable_by_ai"
	}

	public static func shouldAutoSave(sensitivity: String, confidence: Double, type: String) -> Bool {
		guard sensitivity == "normal", confidence >= 0.8 else { return false }
		return type == "preference" || (type == "fact" && confidence >= 0.9)
	}
}
