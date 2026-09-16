import SwiftUI

struct ScheduleSidebarRow: View {
	let schedule: ScheduleViewModel
	let isSelected: Bool

	var body: some View {
		FeatureBrowserRow(
			title: schedule.displayName,
			subtitle: schedule.subtitle,
			isSelected: isSelected,
			accessibilityLabel: "\(schedule.displayName), \(schedule.subtitle), \(schedule.enabled ? "enabled" : "disabled")",
			accessibilityIdentifier: "schedule-sidebar-row-\(schedule.id)"
		) {
			FeatureBrowserRowGlyph(systemImage: "clock", isSelected: isSelected)
		} trailing: {
			Circle()
				.fill(schedule.enabled ? Color.green : AppTheme.tertiaryText)
				.frame(width: 6, height: 6)
				.accessibilityHidden(true)
		}
	}
}
