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
	/// Daemon-executed tool action (not yet wired in the app).
	case tool
	/// Opens `url`.
	case open
	/// Feed-local state change (dismiss).
	case local
}

struct FeedAction: Decodable, Equatable, Identifiable, Sendable {
	let id: String
	let label: String
	let kind: FeedActionKind
	var prompt: String?
	var url: String?

	static let dismissID = "dismiss"

	var isDismiss: Bool { id == Self.dismissID }
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
		default: "sparkle"
		}
	}

	/// Actions the app can perform today, primary first, excluding dismiss.
	var performableActions: [FeedAction] {
		actions.filter { action in
			switch action.kind {
			case .chat: action.prompt?.isEmpty == false
			case .open: action.url.flatMap(URL.init(string:)) != nil
			case .tool, .local: false
			}
		}
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
