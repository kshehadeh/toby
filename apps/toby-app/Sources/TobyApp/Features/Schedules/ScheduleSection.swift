import SwiftUI

struct ScheduleSection<Content: View>: View {
	let title: String
	@ViewBuilder let content: Content

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text(title)
				.font(.caption.weight(.semibold))
				.foregroundStyle(AppTheme.tertiaryText)
				.textCase(.uppercase)
			SettingsCard {
				content
			}
		}
	}
}
