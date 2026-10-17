import Foundation

/// Display-safe tool argument value. Mirrors `ToolDisplayArgs` in
/// `packages/core/src/chat-pipeline/transcript-types.ts`.
enum ToolArgValue: Equatable, Decodable {
	case string(String)
	case number(Double)
	case bool(Bool)
	case list([String])

	init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		if let bool = try? container.decode(Bool.self) {
			self = .bool(bool)
		} else if let number = try? container.decode(Double.self) {
			self = .number(number)
		} else if let string = try? container.decode(String.self) {
			self = .string(string)
		} else if let list = try? container.decode([ToolArgValue].self) {
			self = .list(list.map(\.displayText))
		} else {
			throw DecodingError.dataCorruptedError(
				in: container,
				debugDescription: "Unsupported tool arg value",
			)
		}
	}

	var displayText: String {
		switch self {
		case .string(let value):
			return value
		case .number(let value):
			return value == value.rounded() && abs(value) < 1e15
				? String(Int(value))
				: String(value)
		case .bool(let value):
			return value ? "true" : "false"
		case .list(let values):
			return values.joined(separator: ", ")
		}
	}

	private static let maxStringLength = 240
	private static let maxListCount = 8
	private static let hiddenKeys: Set<String> = ["content", "dataBase64", "body"]

	/// Converts raw SSE tool args into compact display values, matching the
	/// persisted shape produced by core's `sanitizeToolArgsForDisplay`.
	static func displayArgs(from raw: [String: Any]?) -> [String: ToolArgValue]? {
		guard let raw else { return nil }
		var out: [String: ToolArgValue] = [:]
		for (key, value) in raw where !hiddenKeys.contains(key) {
			if let bool = value as? Bool {
				out[key] = .bool(bool)
			} else if let number = value as? NSNumber {
				out[key] = .number(number.doubleValue)
			} else if let string = value as? String {
				let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
				guard !trimmed.isEmpty else { continue }
				out[key] = .string(truncate(trimmed))
			} else if let array = value as? [Any] {
				let strings = array.compactMap { element -> String? in
					if let string = element as? String { return string }
					if let number = element as? NSNumber { return number.stringValue }
					return nil
				}
				.map { truncate($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
				.filter { !$0.isEmpty }
				.prefix(maxListCount)
				guard !strings.isEmpty else { continue }
				out[key] = .list(Array(strings))
			}
		}
		return out.isEmpty ? nil : out
	}

	private static func truncate(_ value: String) -> String {
		value.count > maxStringLength
			? String(value.prefix(maxStringLength - 1)) + "…"
			: value
	}
}

/// How a tool step should render. Mirrors `ToolPresentation` in core.
struct ToolPresentation: Equatable, Decodable {
	let kind: ToolPresentationKind
	let verbs: [String]?
	let argChips: [String]?
	let primaryArg: String?

	init(
		kind: ToolPresentationKind,
		verbs: [String]? = nil,
		argChips: [String]? = nil,
		primaryArg: String? = nil,
	) {
		self.kind = kind
		self.verbs = verbs
		self.argChips = argChips
		self.primaryArg = primaryArg
	}

	var runningVerb: String? {
		guard let verbs, verbs.count == 2 else { return nil }
		return verbs[0]
	}

	var doneVerb: String? {
		guard let verbs, verbs.count == 2 else { return nil }
		return verbs[1]
	}
}

enum ToolPresentationKind: String, Equatable, Decodable {
	case search
	case read
	case write
	case list
	case fetch
	case action
	case agent
	case generic

	init(from decoder: Decoder) throws {
		let raw = try decoder.singleValueContainer().decode(String.self)
		self = ToolPresentationKind(rawValue: raw) ?? .generic
	}
}

enum ToolProgressItemState: String, Equatable, Decodable {
	case waiting
	case running
	case done
	case failed

	init(from decoder: Decoder) throws {
		let raw = try decoder.singleValueContainer().decode(String.self)
		self = ToolProgressItemState(rawValue: raw) ?? .running
	}
}

/// One transient sub-item on a running tool step's live rail.
struct ToolProgressItem: Equatable, Decodable, Identifiable {
	let id: String
	let label: String
	let state: ToolProgressItemState
	let detail: String?
	let url: String?

	init(
		id: String,
		label: String,
		state: ToolProgressItemState,
		detail: String? = nil,
		url: String? = nil,
	) {
		self.id = id
		self.label = label
		self.state = state
		self.detail = detail
		self.url = url
	}
}

/// Live progress for a running tool call (from `tool_call_progress`).
/// Transient: never persisted, cleared when the call completes successfully.
struct ToolStepProgress: Equatable {
	var items: [ToolProgressItem]
	var fraction: Double?

	/// Cheap change fingerprint for transcript row invalidation.
	var stamp: Int {
		var hash = items.count &* 31
		for item in items {
			hash = hash &+ item.id.hashValue &+ item.label.count &+ item.state.rawValue.count
				&+ (item.detail?.hashValue ?? 0)
		}
		return hash &+ Int((fraction ?? 0) * 1000)
	}
}
