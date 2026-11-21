import Foundation

// MARK: - Identity

/// Identity for a Home Actions tile. Raw values are the flow id.
struct DashboardBlockID: Hashable, Sendable, RawRepresentable, Codable {
	let rawValue: String

	init(rawValue: String) {
		self.rawValue = rawValue
	}

	init(_ rawValue: String) {
		self.rawValue = rawValue
	}
}

// MARK: - Actions

/// App shell hooks Home sections may invoke (chat, navigation, flow runs).
struct DashboardBlockActionContext {
	var startChat: @MainActor () -> Void = {}
	/// Opens a new chat seeded with a prompt (The Feed chat actions).
	var startChatWithPrompt: @MainActor (String) -> Void = { _ in }
	/// Shows an app toast (The Feed action confirmations / errors).
	var showToast: @MainActor (AppToastState) -> Void = { _ in }
	var openFlow: @MainActor (String) -> Void = { _ in }
	/// Runs a custom flow by id. Returns the daemon response when the request
	/// completed (including `ok: false`); `nil` when the HTTP call itself failed.
	var runFlow: @MainActor (String) async -> FlowRunNowResponse? = { _ in nil }
}

// MARK: - Descriptor

/// Static definition of one Home Actions tile (a runner-variant custom flow).
struct DashboardBlockDescriptor: Identifiable, Sendable, Equatable {
	let id: DashboardBlockID
	let title: String
	let systemImage: String
	/// Default order (server order: by title).
	let sortIndex: Int
	/// Accessibility id for the tile root.
	let accessibilityIdentifier: String
	var flowDescription: String? = nil
	var flowColor: String? = nil
	var dashboardColor: String? = nil
	var showsResultSheet: Bool = false

	var rawId: String { id.rawValue }

	static func flow(_ info: FlowDashboardBlockInfo, sortIndex: Int) -> DashboardBlockDescriptor {
		DashboardBlockDescriptor(
			id: DashboardBlockID(info.id),
			title: info.title,
			systemImage: FlowIconOption.resolvedSymbol(info.icon, fallback: "play.circle"),
			sortIndex: sortIndex,
			accessibilityIdentifier: "dashboard-flow-\(info.id)",
			flowDescription: info.description,
			flowColor: info.color,
			dashboardColor: info.dashboardColor,
			showsResultSheet: info.showsResultSheet ?? false
		)
	}
}
