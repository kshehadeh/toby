import SwiftUI

struct SettingsActionButton: View {
	let title: String
	var showsExternalIcon = false
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			HStack(spacing: 6) {
				Text(title)
					.font(.body)
				if showsExternalIcon {
					Image(systemName: "arrow.up.right.square")
						.font(.caption)
				}
			}
			.foregroundStyle(SettingsDesign.rowTitle)
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
		.buttonStyle(.plain)
	}
}
