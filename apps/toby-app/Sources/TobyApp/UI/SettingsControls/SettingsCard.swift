import SwiftUI

struct SettingsCard<Content: View>: View {
	@ViewBuilder let content: Content

	var body: some View {
		VStack(spacing: 0) {
			content
		}
		.background(SettingsDesign.cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
	}
}
