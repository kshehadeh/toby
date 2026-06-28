import SwiftUI

struct SettingsDropdownLabel: View {
	let title: String

	var body: some View {
		HStack(spacing: 8) {
			Text(title)
				.font(.body)
				.foregroundStyle(SettingsDesign.rowTitle)
				.lineLimit(1)
			Image(systemName: "chevron.up.chevron.down")
				.font(.caption2.weight(.semibold))
				.foregroundStyle(SettingsDesign.rowDescription)
		}
		.padding(.horizontal, 12)
		.padding(.vertical, 7)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
				.stroke(SettingsDesign.controlBorder, lineWidth: 1)
		}
	}
}
