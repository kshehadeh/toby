import SwiftUI

// MARK: - Actions rail layout write-throughs

extension AppearancePreferences {
	/// Visibility of a Home Actions tile.
	func isDashboardBlockVisible(id: DashboardBlockID) -> Bool {
		dashboardLayout.isVisible(id: id)
	}

	/// Hides or shows a Home Actions tile (edit mode).
	func setDashboardBlockVisible(id: DashboardBlockID, visible: Bool) {
		let next = dashboardLayout.settingVisibility(id: id, visible: visible)
		guard next != dashboardLayout else { return }
		dashboardLayout = next
	}

	/// Restore hidden tiles, colors, and the Actions rail. Does not change onboarding.
	func resetDashboardLayout() {
		withAnimation(DashboardSectionMotion.animation) {
			dashboardLayout = .empty
		}
	}

	/// Toolbar toggle for the Actions rail (independent of per-tile hide).
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
