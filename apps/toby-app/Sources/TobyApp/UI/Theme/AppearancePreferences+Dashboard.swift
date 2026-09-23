import SwiftUI

// MARK: - Dashboard blocks

/// Home cards the user can show or hide under Settings → Home.
enum DashboardBlock: String, CaseIterable, Identifiable, Sendable {
	case email
	case tasks
	case calendar

	var id: String { rawValue }

	var displayName: String {
		switch self {
		case .email: "Unread mail"
		case .tasks: "Tasks"
		case .calendar: "Upcoming"
		}
	}

	var settingsTitle: String {
		switch self {
		case .email: "Show unread mail"
		case .tasks: "Show tasks"
		case .calendar: "Show upcoming events"
		}
	}

	var settingsDescription: String {
		switch self {
		case .email: "Show the unread mail card on the home dashboard. Stored only on this Mac."
		case .tasks: "Show the tasks card on the home dashboard. Stored only on this Mac."
		case .calendar:
			"Show the upcoming events card on the home dashboard. Stored only on this Mac."
		}
	}

	var accessibilityIdentifier: String {
		"dashboard-show-\(rawValue)-toggle"
	}

	/// Legacy UserDefaults key mirrored when the layout document is persisted.
	var defaultsKey: String {
		switch self {
		case .email: AppearanceDefaultsKey.showDashboardEmail
		case .tasks: AppearanceDefaultsKey.showDashboardTasks
		case .calendar: AppearanceDefaultsKey.showDashboardCalendar
		}
	}
}

// MARK: - Layout write-throughs

extension AppearancePreferences {
	/// When true, show the unread mail card on the home dashboard. Default is on.
	var showDashboardEmail: Bool {
		get { dashboardLayout.isVisible(id: .email) }
		set { setDashboardBlockVisible(id: .email, visible: newValue) }
	}

	/// When true, show the tasks card on the home dashboard. Default is on.
	var showDashboardTasks: Bool {
		get { dashboardLayout.isVisible(id: .tasks) }
		set { setDashboardBlockVisible(id: .tasks, visible: newValue) }
	}

	/// When true, show the upcoming events card on the home dashboard. Default is on.
	var showDashboardCalendar: Bool {
		get { dashboardLayout.isVisible(id: .calendar) }
		set { setDashboardBlockVisible(id: .calendar, visible: newValue) }
	}

	/// Whether the given dashboard block should be visible on the home screen.
	func isDashboardBlockVisible(_ block: DashboardBlock) -> Bool {
		isDashboardBlockVisible(id: DashboardBlockID(block.rawValue))
	}

	/// Visibility by block id (built-ins and custom flow cards).
	func isDashboardBlockVisible(id: DashboardBlockID) -> Bool {
		dashboardLayout.isVisible(id: id)
	}

	/// Updates visibility for a dashboard block (used by Settings toggles and edit mode).
	func setDashboardBlockVisible(_ block: DashboardBlock, visible: Bool) {
		setDashboardBlockVisible(id: DashboardBlockID(block.rawValue), visible: visible)
	}

	func setDashboardBlockVisible(id: DashboardBlockID, visible: Bool) {
		let next = dashboardLayout.settingVisibility(id: id, visible: visible)
		guard next != dashboardLayout else { return }
		dashboardLayout = next
	}

	/// Binding for a dashboard-block visibility toggle in Settings.
	/// Mutations run inside `withAnimation` so the home dashboard can transition
	/// sections in/out when the Settings window is open alongside it.
	func dashboardBlockVisibilityBinding(_ block: DashboardBlock) -> Binding<Bool> {
		Binding(
			get: { self.isDashboardBlockVisible(block) },
			set: { newValue in
				withAnimation(DashboardSectionMotion.animation) {
					self.setDashboardBlockVisible(block, visible: newValue)
				}
			}
		)
	}

	/// Restore default card order and show all cards. Does not change onboarding.
	func resetDashboardLayout() {
		withAnimation(DashboardSectionMotion.animation) {
			dashboardLayout = .empty
		}
	}

	/// Toolbar toggle for the Actions rail (independent of per-runner hide).
	func toggleDashboardActionsVisible() {
		var next = dashboardLayout
		next.actionsVisible.toggle()
		guard next != dashboardLayout else { return }
		dashboardLayout = next
	}

	func setDashboardActionsWidth(_ width: CGFloat) {
		var next = dashboardLayout
		next.actionsWidth = DashboardLayout.clampedActionsWidth(width)
		guard next != dashboardLayout else { return }
		dashboardLayout = next
	}
}
