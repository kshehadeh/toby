import SwiftUI

struct RecordingsDetailView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				if store.isDetailLoading && store.selectedRecordings.count == 1 && store.detail == nil {
					ProgressView("Loading recording...")
						.frame(maxWidth: .infinity, minHeight: 240)
			} else if !store.selectedRecordings.isEmpty {
				if store.selectedRecordings.count == 1, store.detail != nil {
					if isProcessingSelected {
						RecordingProcessingCard(processingState: processingState)
					}
					RecordingDetailContent(store: store, recordingId: store.selectedRecording?.id)
				} else {
						SelectedRecordingsDeck(recordings: store.selectedRecordings)
					}
				} else if let errorMessage = store.errorMessage {
					ContentUnavailableView {
						Label("Recordings unavailable", systemImage: "exclamationmark.triangle")
					} description: {
						Text(errorMessage)
					}
				} else {
					Text("Select a recording")
						.foregroundStyle(SettingsDesign.rowDescription)
				}

				if let errorMessage = store.errorMessage, !store.selectedRecordings.isEmpty {
					Text(errorMessage)
						.font(.caption)
						.foregroundStyle(.red)
				}
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth)
			.frame(maxWidth: .infinity)
			.padding(.horizontal, 32)
			.padding(.vertical, 28)
		}
		.background(SettingsDesign.canvasBackground)
	}

	private var isProcessingSelected: Bool {
		guard let id = processingState?.recordingId,
			processingState?.isActive == true else { return false }
		return store.selectedRecordingIds.contains(id)
	}
}
