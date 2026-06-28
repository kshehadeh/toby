import SwiftUI

struct RecordingSidebarRow: View {
	let recording: ListenRecordingSummary
	let isSelected: Bool
	var isProcessing: Bool = false
	var processingStage: RecordingProcessingStage? = nil

	var body: some View {
		HStack(spacing: 8) {
			if isProcessing {
				ProgressView()
					.scaleEffect(0.55)
					.frame(width: 18, height: 18)
			} else {
				Image(systemName: recording.hasTranscript ? "doc.text" : "waveform")
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
					.frame(width: 18)
			}
			VStack(alignment: .leading, spacing: 3) {
				Text(recordingSidebarTitle(recording))
					.font(.callout)
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				Text(isProcessing ? (processingStage?.label ?? "Processing…") : recordingSummary(recording))
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 7)
		.padding(.horizontal, 8)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(isSelected ? SettingsDesign.sidebarSelection : Color.clear)
		)
	}
}
