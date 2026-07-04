import SwiftUI

struct RecordingsDetailView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil
	var validSessionIds: Set<String> = []
	var onStartRecording: (() -> Void)? = nil

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if store.isLoading && store.recordings.isEmpty {
				ProgressView("Loading recordings…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if store.isDetailLoading && store.selectedRecordings.count == 1 && store.detail == nil {
				ProgressView("Loading recording...")
					.frame(maxWidth: .infinity, minHeight: 240)
			} else if !store.selectedRecordings.isEmpty {
				if store.selectedRecordings.count == 1, store.detail != nil {
					if isProcessingSelected {
						RecordingProcessingCard(processingState: processingState)
							.padding(.horizontal, 24)
							.padding(.top, 12)
					}
					RecordingDetailContent(store: store, recordingId: store.selectedRecording?.id, processingState: processingState, validSessionIds: validSessionIds)
				} else {
					SelectedRecordingsDeck(recordings: store.selectedRecordings)
				}
			} else if let errorMessage = store.errorMessage, store.recordings.isEmpty {
				ContentUnavailableView {
					Label("Recordings unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else if store.recordings.isEmpty {
				RecordingsEmptyStateView(onStartRecording: onStartRecording)
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

private struct RecordingsEmptyStateView: View {
	var onStartRecording: (() -> Void)?

	var body: some View {
		VStack(spacing: 18) {
			Image(systemName: "waveform")
				.font(.system(size: 72, weight: .regular))
				.foregroundStyle(SettingsDesign.rowDescription)
				.accessibilityHidden(true)

			VStack(spacing: 8) {
				Text("Recordings")
					.font(.system(size: 28, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)

				Text("Recordings capture audio and transcribe it so you can search, revisit, and chat about what was said.")
					.font(.body)
					.foregroundStyle(SettingsDesign.rowDescription)
					.multilineTextAlignment(.center)
					.lineLimit(3)
					.frame(maxWidth: 480)
			}

			if let onStartRecording {
				Button {
					onStartRecording()
				} label: {
					Label("Start Recording", systemImage: "record.circle")
				}
				.buttonStyle(.borderedProminent)
				.accessibilityIdentifier("empty-start-recording-button")
			}
		}
		.padding(32)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.accessibilityElement(children: .contain)
	}
}
