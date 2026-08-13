import SwiftUI

/// Pulsing placeholder bars used while a selected recording's heavy detail loads.
struct RecordingBlockSkeleton: View {
	var lineCount: Int = 8
	var accessibilityIdentifier: String = "recording-block-skeleton"

	@State private var pulse = false

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			ForEach(0 ..< lineCount, id: \.self) { index in
				RoundedRectangle(cornerRadius: 4)
					.fill(SettingsDesign.cardBorder)
					.frame(maxWidth: index % 4 == 3 ? 180 : .infinity)
					.frame(height: 12)
			}
		}
		.padding(12)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(SettingsDesign.cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
		.opacity(pulse ? 0.45 : 1)
		.animation(.easeInOut(duration: 1).repeatForever(autoreverses: true), value: pulse)
		.onAppear { pulse = true }
		.accessibilityIdentifier(accessibilityIdentifier)
		.accessibilityLabel("Loading")
	}
}

struct RecordingAudioPlayerSkeleton: View {
	@State private var pulse = false

	var body: some View {
		SettingsCard {
			VStack(alignment: .leading, spacing: 12) {
				RoundedRectangle(cornerRadius: 4)
					.fill(SettingsDesign.cardBorder)
					.frame(height: 22)
				HStack(spacing: 12) {
					Circle()
						.fill(SettingsDesign.cardBorder)
						.frame(width: 32, height: 32)
					VStack(alignment: .leading, spacing: 8) {
						RoundedRectangle(cornerRadius: 4)
							.fill(SettingsDesign.cardBorder)
							.frame(height: 8)
						HStack {
							RoundedRectangle(cornerRadius: 3)
								.fill(SettingsDesign.cardBorder)
								.frame(width: 36, height: 8)
							Spacer()
							RoundedRectangle(cornerRadius: 3)
								.fill(SettingsDesign.cardBorder)
								.frame(width: 36, height: 8)
						}
					}
				}
			}
			.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
			.padding(.vertical, SettingsDesign.rowVerticalPadding)
		}
		.opacity(pulse ? 0.45 : 1)
		.animation(.easeInOut(duration: 1).repeatForever(autoreverses: true), value: pulse)
		.onAppear { pulse = true }
		.accessibilityIdentifier("recording-audio-skeleton")
		.accessibilityLabel("Loading audio player")
	}
}
