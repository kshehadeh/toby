import SwiftUI

struct RecordingsDetailView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil
	var validSessionIds: Set<String> = []
	var onStartRecording: (() -> Void)? = nil
	var onStopRecording: (() -> Void)? = nil
	var activeRecording: ActiveRecordingInfo? = nil

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if store.isLoading && store.recordings.isEmpty && activeRecording == nil {
				ProgressView("Loading recordings…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let active = activeRecording, store.selectedActiveRecordingId == active.id || store.selectedRecordings.isEmpty {
				ActiveRecordingDetailView(active: active, onStopRecording: onStopRecording)
			} else if processingState?.isActive == true, store.selectedRecordings.isEmpty {
				RecordingProcessingCard(processingState: processingState)
					.padding(32)
					.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
			} else if !store.selectedRecordings.isEmpty {
				if store.selectedRecordings.count == 1, let recording = store.selectedRecording {
					if isProcessingSelected {
						RecordingProcessingCard(processingState: processingState)
							.padding(.horizontal, 24)
							.padding(.top, 12)
					}
					let displayedDetail = displayedDetail(for: recording)
					RecordingDetailContent(
						store: store,
						detail: displayedDetail,
						processingState: processingState,
						validSessionIds: validSessionIds,
						isLoadingHeavyContent: isLoadingHeavyContent(displayedDetail),
					)
				} else {
					SelectedRecordingsDeck(recordings: store.selectedRecordings)
				}
			} else if let errorMessage = store.errorMessage, store.recordings.isEmpty {
				ContentUnavailableView {
					Label("Recordings unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else if store.recordings.isEmpty && activeRecording == nil {
				RecordingsEmptyStateView(onStartRecording: onStartRecording)
			} else {
				Text("Select a recording")
					.foregroundStyle(SettingsDesign.rowDescription)
			}

			if let errorMessage = store.errorMessage, !store.selectedRecordings.isEmpty {
				InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
					.padding(.horizontal, 16)
					.padding(.bottom, 8)
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

	private func displayedDetail(for recording: ListenRecordingSummary) -> ListenRecordingDetail {
		if let detail = store.detail, detail.id == recording.id {
			return detail
		}
		return .placeholder(from: recording)
	}

	private func isLoadingHeavyContent(_ detail: ListenRecordingDetail) -> Bool {
		store.isDetailLoading && detail.isShell
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

private struct ActiveRecordingDetailView: View {
	let active: ActiveRecordingInfo
	var onStopRecording: (() -> Void)? = nil

	var body: some View {
		VStack(spacing: 24) {
			Image(systemName: "record.circle")
				.font(.system(size: 56, weight: .regular))
				.foregroundStyle(.red)
				.symbolEffect(.variableColor.iterative, options: .repeating)
				.accessibilityHidden(true)

			VStack(spacing: 8) {
				Text("Recording in progress")
					.font(.system(size: 24, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)

				Text("Audio is being captured. Transcription, playback, and chat will be available after you stop recording.")
					.font(.body)
					.foregroundStyle(SettingsDesign.rowDescription)
					.multilineTextAlignment(.center)
					.lineLimit(4)
					.frame(maxWidth: 480)
			}

			if let onStopRecording {
				Button {
					onStopRecording()
				} label: {
					Label("Stop Recording", systemImage: "stop.circle.fill")
				}
				.buttonStyle(.borderedProminent)
				.tint(.red)
				.accessibilityIdentifier("active-stop-recording-button")
			}

			VStack(alignment: .leading, spacing: 10) {
				metadataRow(label: "Started", value: friendlyRecordingDate(active.startedAt, fallback: active.startedAt))
				metadataRow(label: "Sources", value: sourceText(active.sources))
				if let dir = active.outputDir {
					metadataRow(label: "Location", value: dir)
				}
			}
			.padding(16)
			.frame(maxWidth: 400)
			.background(SettingsDesign.cardBackground)
			.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
			.overlay {
				RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
					.stroke(SettingsDesign.cardBorder, lineWidth: 1)
			}
		}
		.padding(32)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier("active-recording-detail")
	}

	private func metadataRow(label: String, value: String) -> some View {
		VStack(alignment: .leading, spacing: 2) {
			Text(label)
				.font(.system(size: 11))
				.foregroundStyle(SettingsDesign.rowDescription)
			Text(value)
				.font(.system(size: 12))
				.foregroundStyle(SettingsDesign.rowTitle)
				.lineLimit(2)
				.textSelection(.enabled)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}
