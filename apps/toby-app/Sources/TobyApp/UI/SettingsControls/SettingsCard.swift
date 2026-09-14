import SwiftUI

struct SettingsCard<Content: View>: View {
	@ViewBuilder let content: Content

	var body: some View {
		let shape = AppTheme.concentricRect(minimum: SettingsDesign.cardCornerRadius)
		VStack(spacing: 0) {
			content
		}
		.background(SettingsDesign.cardBackground, in: shape)
		.overlay {
			shape.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
	}
}
