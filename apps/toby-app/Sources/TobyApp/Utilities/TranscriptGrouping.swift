import Foundation

enum TranscriptGrouping {
	static func isHiddenLifecycleHeader(_ header: String) -> Bool {
		let trimmed = header.trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed == "Updating session messages…"
			|| trimmed == "Saving session…"
			|| trimmed == "Preparing Session…"
		{
			return true
		}
		if trimmed.hasPrefix("Chatting with ") {
			return true
		}
		return false
	}

	/// Pretreatment selection notices (skills / tools) — debug transcript only.
	static func isDebugSelectionNotice(_ text: String) -> Bool {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed.hasPrefix("Skills:") {
			return true
		}
		// e.g. "5 tools: foo, bar" or "3 core tools"
		if trimmed.range(of: #"^\d+ (core )?tools"#, options: .regularExpression) != nil {
			return true
		}
		return false
	}

	/// Pipeline variants that contribute to the "Working" / "Worked for" group.
	static func isWorkVariant(_ variant: String) -> Bool {
		switch variant {
		case "lifecycle", "prep", "tool", "plan", "thinking", "assistant_interim":
			return true
		default:
			return false
		}
	}

	static func isVisible(
		_ entry: TranscriptEntry,
		mode: ChatTranscriptMode = .normal,
	) -> Bool {
		switch entry {
		case .meta, .turnWork, .toolCall, .toolOutput:
			return false
		case .notice(let text, _):
			if mode == .normal, isDebugSelectionNotice(text) {
				return false
			}
			return true
		case .boxedStep(let payload):
			if payload.variant == "assistant" {
				return true
			}
			// Interim assistant replies surface as conversation rows in normal mode.
			if payload.variant == "assistant_interim" {
				return mode == .normal
			}
			if isWorkVariant(payload.variant) {
				// Work steps are shown via work groups, not as top-level rows.
				return false
			}
			if payload.variant == "lifecycle", isHiddenLifecycleHeader(payload.header) {
				return false
			}
			return mode == .debug
		default:
			return true
		}
	}

	static func isWorkEntry(
		_ entry: TranscriptEntry,
		mode: ChatTranscriptMode = .normal,
	) -> Bool {
		switch entry {
		case .boxedStep(let payload):
			// Keep interim replies in the conversation in normal mode; in debug
			// they live inside the expandable work log.
			if payload.variant == "assistant_interim" {
				return mode == .debug
			}
			return isWorkVariant(payload.variant)
		case .toolCall, .toolOutput:
			return true
		default:
			return false
		}
	}

	static func groupedItems(
		from entries: [TranscriptEntry],
		isLoading: Bool,
		mode: ChatTranscriptMode = .normal,
	) -> [TranscriptDisplayItem] {
		var items: [TranscriptDisplayItem] = []
		var workBuffer: [TranscriptEntry] = []
		var pendingWorkDurationMs: Int?
		var lastUserIndex: Int?

		func flushWork(isActive: Bool) {
			guard !workBuffer.isEmpty else { return }
			let group = TranscriptWorkGroup(
				id: "work-\(lastUserIndex ?? 0)-\(items.count)",
				entries: workBuffer,
				userTurnIndex: lastUserIndex,
				durationMs: pendingWorkDurationMs,
				isActive: isActive,
			)
			items.append(.workGroup(group))
			workBuffer = []
			pendingWorkDurationMs = nil
		}

		for (index, entry) in entries.enumerated() {
			if case .turnWork(let durationMs) = entry {
				pendingWorkDurationMs = durationMs
				continue
			}

			if case .user = entry {
				flushWork(isActive: false)
				lastUserIndex = index
				items.append(.entry(entry, sourceIndex: index))
				continue
			}

			if isWorkEntry(entry, mode: mode) {
				workBuffer.append(entry)
				continue
			}

			guard isVisible(entry, mode: mode) else { continue }

			flushWork(isActive: false)
			items.append(.entry(entry, sourceIndex: index))
		}

		flushWork(isActive: isLoading && !workBuffer.isEmpty)
		return items
	}
}

struct TranscriptWorkGroup: Identifiable, Equatable {
	let id: String
	let entries: [TranscriptEntry]
	let userTurnIndex: Int?
	let durationMs: Int?
	let isActive: Bool
}

extension TranscriptEntry {
	/// Cheap per-row stamp for cache / change detection (not full payload equality).
	/// Used by TranscriptView grouping invalidation and ChatStore streaming writes.
	var contentStamp: Int {
		switch self {
		case .user(let text, let attachments):
			return text.count &+ attachments.count &+ 1
		case .assistant(let text), .meta(let text), .error(let text):
			return text.count &+ 2
		case .notice(let text, _):
			return text.count &+ 3
		case .boxedStep(let payload):
			return payload.id.hashValue
				&+ payload.seq
				&+ payload.body.count
				&+ payload.header.hashValue
				&+ (payload.fullBody?.count ?? 0)
				&+ (payload.durationMs ?? 0)
		case .toolCall(let blockKey, let title, _):
			return blockKey.hashValue &+ title.count &+ 5
		case .toolOutput(let blockKey, let detail, _):
			return blockKey.hashValue &+ detail.count &+ 6
		case .askUserQA(let blockKey, let query, let answer, let error):
			return blockKey.hashValue &+ query.count &+ answer.count &+ (error?.count ?? 0) &+ 7
		case .turnWork(let durationMs):
			return durationMs &+ 8
		}
	}
}

enum TranscriptDisplayItem: Identifiable {
	case entry(TranscriptEntry, sourceIndex: Int)
	case workGroup(TranscriptWorkGroup)

	var id: String {
		switch self {
		case .entry(_, let sourceIndex):
			return "entry-\(sourceIndex)"
		case .workGroup(let group):
			return group.id
		}
	}
}

// Intentionally not Equatable via full payload deep-compare: SwiftUI would walk
// multi-KB tool `fullBody` strings on every parent invalidation / scroll frame.
