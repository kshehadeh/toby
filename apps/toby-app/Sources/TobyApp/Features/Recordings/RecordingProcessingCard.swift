import SwiftUI

struct RecordingProcessingCard: View {
	let processingState: RecordingProcessingState?

	var body: some View {
		if let state = processingState, state.isActive {
			SettingsCard {
				HStack(spacing: 12) {
					ProgressView()
						.scaleEffect(0.8)
					VStack(alignment: .leading, spacing: 2) {
						Text("Processing recording")
							.font(.subheadline.weight(.semibold))
							.foregroundStyle(SettingsDesign.rowTitle)
						Text(state.message ?? state.stage.label)
							.font(.caption)
							.foregroundStyle(SettingsDesign.rowDescription)
					}
					Spacer(minLength: 0)
				}
				.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
				.padding(.vertical, SettingsDesign.rowVerticalPadding)
			}
			.accessibilityIdentifier("recording-processing-card")
			.accessibilityElement(children: .contain)
			.accessibilityLabel("Processing recording")
			.accessibilityValue(state.message ?? state.stage.label)
		}
	}
}
