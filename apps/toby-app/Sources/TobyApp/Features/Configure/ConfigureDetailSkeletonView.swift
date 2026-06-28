import SwiftUI

struct ConfigureDetailSkeletonView: View {
	@State private var pulse = false

	var body: some View {
		VStack(alignment: .leading, spacing: 20) {
			// Section header placeholder
			RoundedRectangle(cornerRadius: 4)
				.fill(SettingsDesign.cardBackground)
				.frame(width: 180, height: 22)

			// Card with row placeholders
			SettingsCard {
				VStack(spacing: 0) {
					ForEach(0..<4, id: \.self) { index in
						HStack(alignment: .center, spacing: 16) {
							VStack(alignment: .leading, spacing: 6) {
								RoundedRectangle(cornerRadius: 4)
									.fill(SettingsDesign.cardBorder)
									.frame(width: CGFloat.random(in: 100...180), height: 14)
								RoundedRectangle(cornerRadius: 4)
									.fill(SettingsDesign.cardBorder)
									.frame(width: CGFloat.random(in: 160...240), height: 12)
							}
							Spacer(minLength: 0)
							RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
								.fill(SettingsDesign.cardBackground)
								.frame(width: 120, height: 30)
						}
						.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
						.padding(.vertical, SettingsDesign.rowVerticalPadding)
						if index < 3 {
							Rectangle()
								.fill(SettingsDesign.cardBorder)
								.frame(height: 1)
								.padding(.leading, SettingsDesign.rowHorizontalPadding)
						}
					}
				}
			}

			// Second card placeholder
			SettingsCard {
				VStack(spacing: 0) {
					ForEach(0..<2, id: \.self) { index in
						HStack(alignment: .center, spacing: 16) {
							VStack(alignment: .leading, spacing: 6) {
								RoundedRectangle(cornerRadius: 4)
									.fill(SettingsDesign.cardBorder)
									.frame(width: CGFloat.random(in: 120...200), height: 14)
								RoundedRectangle(cornerRadius: 4)
									.fill(SettingsDesign.cardBorder)
									.frame(width: CGFloat.random(in: 180...260), height: 12)
							}
							Spacer(minLength: 0)
							RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
								.fill(SettingsDesign.cardBackground)
								.frame(width: 90, height: 30)
						}
						.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
						.padding(.vertical, SettingsDesign.rowVerticalPadding)
						if index < 1 {
							Rectangle()
								.fill(SettingsDesign.cardBorder)
								.frame(height: 1)
								.padding(.leading, SettingsDesign.rowHorizontalPadding)
						}
					}
				}
			}
		}
		.frame(maxWidth: SettingsDesign.contentMaxWidth)
		.frame(maxWidth: .infinity)
		.opacity(pulse ? 0.45 : 1.0)
		.animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: pulse)
		.onAppear { pulse = true }
		.accessibilityIdentifier("settings-detail-skeleton")
	}
}
