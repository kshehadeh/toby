import Foundation

/// Priority bucket for a Feed item, highest first. Mirrors core `FeedTier`.
enum FeedTier: String, Decodable, CaseIterable, Sendable {
	case now
	case today
	case fyi

	var title: String {
		switch self {
		case .now: "Now"
		case .today: "Today"
		case .fyi: "FYI"
		}
	}
}

/// How a Feed call to action runs. Mirrors core `FeedActionKind`.
enum FeedActionKind: String, Decodable, Sendable {
	/// Opens a chat seeded with `prompt`.
	case chat
	/// Daemon-executed action (archive, complete, add todo).
	case tool
	/// Opens `url`.
	case open
	/// Feed state change run by the daemon (snooze, dismiss).
	case local
}

struct FeedAction: Decodable, Equatable, Identifiable, Sendable {
	let id: String
	let label: String
	let kind: FeedActionKind
	var prompt: String?
	var url: String?

	static let dismissID = "dismiss"
	static let snoozeID = "snooze"
	static let draftReplyID = "email.draftReply"
	static let archiveID = "email.archive"
	static let markReadID = "email.markRead"

	var isDismiss: Bool { id == Self.dismissID }
	/// Runs through the daemon (`POST …/feed/actions`) rather than in the app.
	var runsInDaemon: Bool { kind == .tool || kind == .local }
}

struct FeedItemSource: Decodable, Equatable, Sendable {
	let category: String
	let providerName: String
	var providerDisplayName: String?
	let itemId: String
	var url: String?
}

struct FeedItem: Decodable, Equatable, Identifiable, Sendable {
	let id: String
	let source: FeedItemSource
	let tier: FeedTier
	let title: String
	var subtitle: String?
	let reason: String
	var timestamp: String?
	let actions: [FeedAction]

	/// SF Symbol for the item's source category.
	var systemImage: String {
		switch source.category {
		case "email": "envelope"
		case "calendar": "calendar"
		case "tasks", "todos": "checklist"
		case "chat": "bubble.left.and.bubble.right"
		case "news": "newspaper"
		default: "sparkle"
		}
	}

	/// The connection this item came from, e.g. "Apple Reminders". Falls back
	/// to a category label when the daemon didn't send a display name.
	var sourceName: String {
		if let name = source.providerDisplayName?.trimmingCharacters(in: .whitespacesAndNewlines),
		   !name.isEmpty {
			return name
		}
		switch source.category {
		case "email": return "Email"
		case "calendar": return "Calendar"
		case "tasks": return "Tasks"
		case "todos": return "Toby Todos"
		case "chat": return "Chat"
		case "news": return "News"
		default: return source.providerName
		}
	}

	/// Source line under the title: connection, then sender / list / project
	/// when the provider sends one ("Apple Reminders · Errands").
	var sourceLine: String {
		let detail = subtitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return detail.isEmpty ? sourceName : "\(sourceName) · \(detail)"
	}

	/// Calls to action shown as buttons / menu items, primary first
	/// (chat, open, and daemon tool actions; snooze/dismiss are `stateActions`).
	var performableActions: [FeedAction] {
		actions.filter { action in
			switch action.kind {
			case .chat: action.prompt?.isEmpty == false
			case .open: action.url.flatMap(URL.init(string:)) != nil
			case .tool: true
			case .local: false
			}
		}
	}

	/// Feed-state actions (snooze, not relevant, dismiss).
	var stateActions: [FeedAction] { actions.filter { $0.kind == .local } }

	/// Snooze, shown as its own button in the row's action bar.
	var snoozeAction: FeedAction? { stateActions.first { $0.id == FeedAction.snoozeID } }

	/// Feed-state actions for the overflow menu (everything but snooze).
	var menuStateActions: [FeedAction] { stateActions.filter { $0.id != FeedAction.snoozeID } }

	/// The message behind an email item, for the in-app reader.
	var emailReference: EmailReference? {
		guard source.category == "email", source.providerName == "email" else { return nil }
		return EmailReference(itemID: source.itemId)
	}

	var canDismiss: Bool { actions.contains(where: \.isDismiss) }
}

struct FeedModelRef: Decodable, Equatable, Sendable {
	let provider: String
	let model: String
}

/// `GET /api/dashboard/feed` payload. Mirrors core `FeedContent`.
struct FeedContent: Decodable, Equatable, Sendable {
	enum Status: String, Decodable, Sendable {
		case ok
		case setupRequired
		case noSources
		case error
	}

	let status: Status
	let items: [FeedItem]
	let generatedAt: String
	var personaName: String?
	var model: FeedModelRef?
	var setupReason: String?
	var error: String?

	/// Items grouped by tier in tier order, skipping empty tiers.
	func groupedItems(excluding hidden: Set<String> = []) -> [(tier: FeedTier, items: [FeedItem])] {
		let visible = items.filter { !hidden.contains($0.id) }
		return FeedTier.allCases.compactMap { tier in
			let inTier = visible.filter { $0.tier == tier }
			return inTier.isEmpty ? nil : (tier, inTier)
		}
	}
}

/// `POST /api/dashboard/feed/actions` response.
struct FeedActionResponse: Decodable, Equatable, Sendable {
	let ok: Bool
	var message: String?
	var todoId: String?
	/// Current Feed with the acted-on item removed.
	var content: FeedContent?
}

/// A user-written rule for what The Feed includes and how it ranks.
/// Mirrors core `FeedInstruction` (`/api/dashboard/feed/instructions`).
struct FeedInstruction: Decodable, Equatable, Identifiable, Sendable {
	let id: String
	let text: String
	let createdAt: String
	var enabled: Bool
	/// `filter` (hidden in code before ranking), `guidance` (ranker only), or
	/// `pending` (not compiled yet). Absent from older daemons.
	var enforcement: String? = nil
	/// What a `filter` instruction hides, e.g. "Hides Todoist tasks outside the Inbox".
	var enforcementSummary: String? = nil

	/// Character limit enforced by the daemon.
	static let maxLength = 500

	/// One-line caption describing how the instruction is applied, if known.
	var enforcementCaption: String? {
		switch enforcement {
		case "filter":
			let summary = enforcementSummary?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			return summary.isEmpty ? "Always enforced" : "Always enforced · \(summary)"
		case "guidance":
			return "Used as ranking guidance"
		default:
			return nil
		}
	}
}

/// `/api/dashboard/feed/instructions` response.
struct FeedInstructionsResponse: Decodable, Sendable {
	let instructions: [FeedInstruction]
}
