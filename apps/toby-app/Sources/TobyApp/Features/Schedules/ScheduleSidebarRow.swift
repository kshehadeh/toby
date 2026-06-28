import SwiftUI

struct ScheduleSidebarRow: View {
	let schedule: ScheduleViewModel
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: "clock")
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
				.frame(width: 20, height: 20)
			VStack(alignment: .leading, spacing: 2) {
				Text(schedule.displayName)
					.font(.callout.weight(.medium))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				Text(schedule.subtitle)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
			Circle()
				.fill(schedule.enabled ? Color.green : AppTheme.tertiaryText)
				.frame(width: 6, height: 6)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 10)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
		)
	}
}
