import SwiftUI

struct ScheduleHeader: View {
	let schedule: ScheduleViewModel

	var body: some View {
		HStack(alignment: .center, spacing: 14) {
			RoundedRectangle(cornerRadius: 13)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 56, height: 56)
				.overlay {
					Image(systemName: "clock")
						.font(.system(size: 24, weight: .medium))
						.foregroundStyle(AppTheme.accent)
				}

			VStack(alignment: .leading, spacing: 4) {
				Text(schedule.displayName)
					.font(.system(size: 20, weight: .semibold))
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				if let nextRunText = schedule.nextRunText, schedule.enabled {
					Text("Next run \(nextRunText)")
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
				}
			}

			Spacer(minLength: 12)

			SkillStatusPill(enabled: schedule.enabled)
		}
	}
}
