import SwiftUI

struct RecordingsDetailView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil
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
			} else {
				FeatureBrowserPlaceholder(
					systemImage: DetailRoute.recordings.systemImage,
					prompt: "Select a recording",
					onCreate: onStartRecording,
					createPhrase: "start a new recording",
					createAccessibilityIdentifier: "empty-start-recording-button"
				)
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
			.background(
				SettingsDesign.cardBackground,
				in: AppTheme.concentricRect(minimum: SettingsDesign.cardCornerRadius)
			)
			.clipShape(AppTheme.concentricRect(minimum: SettingsDesign.cardCornerRadius))
			.overlay {
				AppTheme.concentricRect(minimum: SettingsDesign.cardCornerRadius)
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
