import Foundation

// MARK: - Identity

/// Identity for a home-dashboard **data** block (not onboarding).
/// Raw value matches the daemon category path (`email`, `tasks`, `calendar`, …).
struct DashboardBlockID: Hashable, Sendable, RawRepresentable, Codable {
	let rawValue: String

	init(rawValue: String) {
		self.rawValue = rawValue
	}

	init(_ rawValue: String) {
		self.rawValue = rawValue
	}

	static let email = DashboardBlockID("email")
	static let tasks = DashboardBlockID("tasks")
	static let calendar = DashboardBlockID("calendar")
}

// MARK: - Snapshot

/// Immutable view of one block's latest content for rendering and actions.
struct DashboardBlockSnapshot: Sendable {
	let id: DashboardBlockID
	let content: DashboardBlockContent?
	let error: String?
}

// MARK: - Actions

/// App shell hooks that block actions may invoke (chat, navigation).
struct DashboardBlockActionContext {
	var startChat: @MainActor () -> Void = {}
	var summarizeEmail: @MainActor () -> Void = {}
	var planInChat: @MainActor () -> Void = {}
	var openFlow: @MainActor (String) -> Void = { _ in }
	/// Runs a custom flow by id. Returns the daemon response when the request
	/// completed (including `ok: false`); `nil` when the HTTP call itself failed.
	var runFlow: @MainActor (String) async -> FlowRunNowResponse? = { _ in nil }
}

/// A single menu / header action declared by a block definition.
struct DashboardBlockAction: Identifiable {
	let id: String
	let title: String
	let isEnabled: Bool
	let perform: () -> Void
}

// MARK: - Descriptor (static registration / card definition)

/// Compile-time **card definition**: sole source of static header chrome
/// (title, icon, actions metadata). Refresh never rewrites these fields.
struct DashboardBlockDescriptor: Identifiable, Sendable {
	let id: DashboardBlockID
	let title: String
	let systemImage: String
	let emptyWhenNil: String
	let emptyWhenZero: String
	/// Hardcoded layout position (lower = first). Later: prefs order.
	let sortIndex: Int
	/// UserDefaults key for show/hide (app-local).
	let visibilityDefaultsKey: String
	/// Accessibility id for the card root.
	let accessibilityIdentifier: String
	/// Optional fallback bundle id when opening primary app with no launchUrl.
	let openFallbackBundleId: String?
	/// Label for the primary open action (e.g. "Open Mail").
	let openPrimaryTitle: String?
	/// Whether the menu lists per-source "Open …" rows from content meta.
	let listsSourceOpenActions: Bool
	/// `runner` / `informational` for custom flow cards; nil for built-ins.
	var flowVariant: String? = nil
	var flowDescription: String? = nil
	var showsResultSheet: Bool = false

	var rawId: String { id.rawValue }
	var isFlowBlock: Bool { flowVariant != nil }
	var isFlowRunner: Bool { flowVariant == "runner" }

	// MARK: Built-in descriptors

	static let email = DashboardBlockDescriptor(
		id: .email,
		title: "Unread mail",
		systemImage: "envelope.fill",
		emptyWhenNil: "No email found. Connect an email account to see unread mail.",
		emptyWhenZero: "You're all caught up. No unread mail.",
		sortIndex: 0,
		visibilityDefaultsKey: AppearanceDefaultsKey.showDashboardEmail,
		accessibilityIdentifier: "dashboard-mail-card",
		openFallbackBundleId: nil,
		openPrimaryTitle: "Open Mail",
		listsSourceOpenActions: false
	)

	static let tasks = DashboardBlockDescriptor(
		id: .tasks,
		title: "Tasks",
		systemImage: "checklist",
		emptyWhenNil: "No tasks found. Connect a task provider to see open tasks.",
		emptyWhenZero: "No open tasks. Nicely done.",
		sortIndex: 1,
		visibilityDefaultsKey: AppearanceDefaultsKey.showDashboardTasks,
		accessibilityIdentifier: "dashboard-tasks-card",
		openFallbackBundleId: nil,
		openPrimaryTitle: nil,
		listsSourceOpenActions: true
	)

	static let calendar = DashboardBlockDescriptor(
		id: .calendar,
		title: "Upcoming",
		systemImage: "calendar",
		emptyWhenNil: "No events found. Connect a calendar provider to see upcoming events.",
		emptyWhenZero: "Nothing on the calendar for the next 7 days.",
		sortIndex: 2,
		visibilityDefaultsKey: AppearanceDefaultsKey.showDashboardCalendar,
		accessibilityIdentifier: "dashboard-calendar-card",
		openFallbackBundleId: "com.apple.iCal",
		openPrimaryTitle: "Open Calendar",
		listsSourceOpenActions: false
	)

	/// Default registered data blocks (order = default layout).
	static let builtIn: [DashboardBlockDescriptor] = [
		.email,
		.tasks,
		.calendar,
	]

	static func flow(_ info: FlowDashboardBlockInfo, sortIndex: Int) -> DashboardBlockDescriptor {
		DashboardBlockDescriptor(
			id: DashboardBlockID(info.id),
			title: info.title,
			systemImage: "arrow.triangle.branch",
			emptyWhenNil: "Run this flow to see output here.",
			emptyWhenZero: "Run this flow to see output here.",
			sortIndex: sortIndex,
			visibilityDefaultsKey: "toby.appearance.showDashboardFlow.\(info.id)",
			accessibilityIdentifier: "dashboard-flow-\(info.id)",
			openFallbackBundleId: nil,
			openPrimaryTitle: nil,
			listsSourceOpenActions: false,
			flowVariant: info.variant,
			flowDescription: info.description,
			showsResultSheet: info.showsResultSheet ?? false
		)
	}
}
