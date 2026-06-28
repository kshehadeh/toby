import SwiftUI

struct ScheduleHeader: View {
	let schedule: ScheduleViewModel

	var body: some View {
		HStack(spacing: 14) {
			RoundedRectangle(cornerRadius: 12)
				.fill(AppTheme.accent.opacity(0.18))
				.frame(width: 48, height: 48)
				.overlay {
					Image(systemName: "clock")
						.font(.system(size: 22, weight: .medium))
						.foregroundStyle(AppTheme.accent)
				}
			VStack(alignment: .leading, spacing: 4) {
				Text(schedule.displayName)
					.font(.title3.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				HStack(spacing: 6) {
					Circle()
						.fill(schedule.enabled ? Color.green : AppTheme.tertiaryText)
						.frame(width: 6, height: 6)
					Text(statusText)
						.font(.subheadline)
						.foregroundStyle(AppTheme.secondaryText)
				}
			}
		}
	}

	private var statusText: String {
		var parts: [String] = [schedule.enabled ? "Enabled" : "Disabled"]
		if let nextRunText = schedule.nextRunText, schedule.enabled {
			parts.append("Next run \(nextRunText)")
		}
		return parts.joined(separator: " · ")
	}
}
