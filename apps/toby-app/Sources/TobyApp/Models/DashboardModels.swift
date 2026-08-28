import Foundation

/// Deterministic urgency signal carried by dashboard items (aggregator / tools).
enum DashboardUrgency: String, Decodable {
	case low
	case normal
	case high
}

/// A single item in a dashboard summary (email message, task, reminder, etc.).
struct DashboardItem: Decodable, Identifiable, Equatable {
	let id: String
	let title: String
	let subtitle: String?
	let detail: String?
	let timestamp: String?
	let urgency: DashboardUrgency?
	let url: String?
	let groupId: String?
	let providerName: String?
}

/// A deterministic bucket (folder, label, flag, list) surfaced by a provider.
struct DashboardGroup: Decodable, Identifiable, Equatable {
	let id: String
	let label: String
	let count: Int
}

/// Reserved output shape returned by a single provider's standard tool.
struct DashboardSummaryResult: Decodable, Equatable {
	let count: Int
	let groups: [DashboardGroup]?
	let items: [DashboardItem]
	let generatedAt: String
}

/// A single provider's dashboard summary, with provider metadata for UI rows.
struct DashboardProviderSummary: Decodable, Identifiable, Equatable {
	let providerName: String
	let providerDisplayName: String
	let iconUrl: String?
	let launchUrl: String?
	let summary: DashboardSummaryResult

	var id: String { providerName }
}

/// Aggregated dashboard summary for a single category (internal / debug API).
struct DashboardCategorySummary: Decodable, Equatable {
	let count: Int
	let sources: [DashboardProviderSummary]
	let items: [DashboardItem]
	let groups: [DashboardGroup]
	let generatedAt: String
}

/// Full dashboard data response, one entry per supported category.
struct DashboardData: Decodable, Equatable {
	let email: DashboardCategorySummary?
	let tasks: DashboardCategorySummary?
	let calendar: DashboardCategorySummary?
}

/// Provider open target on block content (multi-source "Open …" actions).
struct DashboardBlockContentSource: Decodable, Identifiable, Equatable {
	let providerName: String
	let providerDisplayName: String
	let launchUrl: String?

	var id: String { providerName }
}

/// Custom flow opted onto the home dashboard.
struct FlowDashboardBlockInfo: Decodable, Identifiable, Equatable {
	let id: String
	let flowId: String
	let title: String
	let description: String?
	let variant: String
	let refresh: String?
	let lastRanAt: String?
	let showsResultSheet: Bool?

	var isRunner: Bool { variant == "runner" }
}

/// Home-dashboard **block content** — sole payload for a card body.
/// Header chrome comes only from the card definition.
struct DashboardBlockContent: Decodable, Equatable {
	/// Block / category id (e.g. "email").
	let category: String
	/// Body markdown from the block's flow. Empty when nothing to show.
	let text: String
	let generatedAt: String
	let personaName: String
	/// Item count for empty UX and action enablement.
	let count: Int
	let launchUrls: [String]?
	let sources: [DashboardBlockContentSource]?

	/// Non-empty body ready to render.
	var hasBody: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

/// Legacy name for block content (same JSON shape).
typealias DashboardCategoryAiSummary = DashboardBlockContent

enum DashboardDate {
	static func parse(_ raw: String?) -> Date? {
		guard let raw, !raw.isEmpty else { return nil }
		let fractional = ISO8601DateFormatter()
		fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return fractional.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
	}
}
