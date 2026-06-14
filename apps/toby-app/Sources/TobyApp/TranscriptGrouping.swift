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

	static func isVisible(_ entry: TranscriptEntry) -> Bool {
		switch entry {
		case .meta, .turnWork:
			return false
		case .boxedStep(let payload):
			if payload.variant == "prep" {
				return false
			}
			if payload.variant == "lifecycle", isHiddenLifecycleHeader(payload.header) {
				return false
			}
			return true
		default:
			return true
		}
	}

	static func isWorkEntry(_ entry: TranscriptEntry) -> Bool {
		switch entry {
		case .boxedStep(let payload):
			switch payload.variant {
			case "lifecycle", "prep", "tool", "plan", "thinking":
				return true
			default:
				return false
			}
		case .toolCall, .toolOutput:
			return true
		default:
			return false
		}
	}

	static func groupedItems(
		from entries: [TranscriptEntry],
		isLoading: Bool,
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

			if isWorkEntry(entry) {
				workBuffer.append(entry)
				continue
			}

			guard isVisible(entry) else { continue }

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

enum TranscriptDisplayItem: Identifiable, Equatable {
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
