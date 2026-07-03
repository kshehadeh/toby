import SwiftUI

/// Skeleton placeholder shown while credential fields are being reloaded
/// after an auth method change. Displays pulsing placeholder rows that
/// match the visual structure of the real credentials card.
struct CredentialsSkeletonView: View {
	@State private var pulse = false
	var title: String = "Configuration"

	var body: some View {
		VStack(alignment: .leading, spacing: 16) {
			Text(title)
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)

			SettingsCard {
				VStack(spacing: 0) {
					ForEach(0..<3, id: \.self) { index in
						HStack(alignment: .center, spacing: 16) {
							VStack(alignment: .leading, spacing: 6) {
								RoundedRectangle(cornerRadius: 4)
									.fill(SettingsDesign.cardBorder)
									.frame(width: skeletonLabelWidth(index), height: 14)
								RoundedRectangle(cornerRadius: 4)
									.fill(SettingsDesign.cardBorder)
									.frame(width: skeletonValueWidth(index), height: 12)
							}
							Spacer(minLength: 0)
							RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
								.fill(SettingsDesign.cardBackground)
								.frame(width: 120, height: 30)
						}
						.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
						.padding(.vertical, SettingsDesign.rowVerticalPadding)
						if index < 2 {
							Rectangle()
								.fill(SettingsDesign.cardBorder)
								.frame(height: 1)
								.padding(.leading, SettingsDesign.rowHorizontalPadding)
						}
					}
				}
			}
		}
		.opacity(pulse ? 0.45 : 1.0)
		.animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: pulse)
		.onAppear { pulse = true }
		.accessibilityIdentifier("credentials-skeleton")
	}

	private func skeletonLabelWidth(_ index: Int) -> CGFloat {
		[120, 140, 100][index % 3]
	}

	private func skeletonValueWidth(_ index: Int) -> CGFloat {
		[200, 180, 240][index % 3]
	}
}
