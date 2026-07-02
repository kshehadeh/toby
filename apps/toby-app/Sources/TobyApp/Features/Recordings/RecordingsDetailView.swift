import SwiftUI

struct RecordingsDetailView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if store.isDetailLoading && store.selectedRecordings.count == 1 && store.detail == nil {
				ProgressView("Loading recording...")
					.frame(maxWidth: .infinity, minHeight: 240)
			} else if !store.selectedRecordings.isEmpty {
				if store.selectedRecordings.count == 1, store.detail != nil {
					if isProcessingSelected {
						RecordingProcessingCard(processingState: processingState)
							.padding(.horizontal, 24)
							.padding(.top, 12)
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
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
	}

	private var isProcessingSelected: Bool {
		guard let id = processingState?.recordingId,
			processingState?.isActive == true else { return false }
		return store.selectedRecordingIds.contains(id)
	}
}
