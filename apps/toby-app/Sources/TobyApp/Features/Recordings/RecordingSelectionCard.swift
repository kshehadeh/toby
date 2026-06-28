import SwiftUI

struct RecordingSelectionCard: View {
	let recording: ListenRecordingSummary

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack(spacing: 8) {
				Image(systemName: recording.hasTranscript ? "doc.text" : "waveform")
				Text(recordingSidebarTitle(recording))
					.lineLimit(1)
			}
			Text(recordingSummary(recording))
				.font(.caption)
				.foregroundStyle(AppTheme.secondaryText)
		}
		.padding(12)
		.frame(width: 240, alignment: .leading)
		.background(SettingsDesign.cardBackground)
		.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		}
	}
}
