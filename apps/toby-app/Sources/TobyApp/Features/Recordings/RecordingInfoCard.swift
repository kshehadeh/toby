import SwiftUI

struct RecordingInfoCard: View {
	let label: String
	let value: String

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text(label)
				.font(.caption.weight(.medium))
				.foregroundStyle(AppTheme.secondaryText)
			Text(value)
				.font(.subheadline)
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(2)
				.textSelection(.enabled)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(.horizontal, 14)
		.padding(.vertical, 12)
		.background(SettingsDesign.cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
	}
}
