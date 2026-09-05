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
				RecordingsHomeView(store: store, processingState: processingState)
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

struct RecordingsHomeView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil

	private let columns = [
		GridItem(.adaptive(minimum: 240, maximum: 360), spacing: 16),
	]

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				header
				LazyVGrid(columns: columns, spacing: 16) {
					ForEach(store.recordings) { recording in
						Button {
							Task { await store.selectRecording(id: recording.id) }
						} label: {
							RecordingCard(
								recording: recording,
								isProcessing: processingState?.recordingId == recording.id
									&& processingState?.isActive == true,
							)
						}
						.buttonStyle(.plain)
						.accessibilityIdentifier("recording-card-\(recording.id)")
					}
				}
			}
			.padding(24)
			.frame(maxWidth: 980)
			.frame(maxWidth: .infinity)
		}
		.accessibilityIdentifier("recordings-home-view")
	}

	private var header: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Recordings")
				.font(.system(size: 24, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("Review audio, transcripts, and summaries from your recordings. Select a recording to open it.")
				.font(.body)
				.foregroundStyle(SettingsDesign.rowDescription)
				.fixedSize(horizontal: false, vertical: true)
		}
	}
}

struct RecordingCard: View {
	let recording: ListenRecordingSummary
	var isProcessing = false

	private var statusText: String {
		if isProcessing { return "Processing…" }
		if recording.hasTranscript { return "Transcribed" }
		if recording.hasAudio { return "Recorded" }
		return "Saved"
	}

	private var statusColor: Color {
		if isProcessing { return .orange }
		if recording.hasTranscript { return .green }
		if recording.hasAudio { return .orange }
		return AppTheme.tertiaryText
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			HStack(alignment: .top, spacing: 12) {
				RoundedRectangle(cornerRadius: 10)
					.fill(AppTheme.accent.opacity(0.16))
					.frame(width: 40, height: 40)
					.overlay {
						if isProcessing {
							ProgressView()
								.scaleEffect(0.7)
						} else {
							Image(systemName: recording.hasTranscript ? "doc.text" : "waveform")
								.font(.system(size: 17, weight: .semibold))
								.foregroundStyle(AppTheme.accent)
								.accessibilityHidden(true)
						}
					}
				VStack(alignment: .leading, spacing: 4) {
					Text(recordingSidebarTitle(recording))
						.font(.system(size: 15, weight: .semibold))
						.foregroundStyle(SettingsDesign.rowTitle)
						.lineLimit(2)
						.multilineTextAlignment(.leading)
					HStack(spacing: 6) {
						Circle()
							.fill(statusColor)
							.frame(width: 6, height: 6)
						Text(statusText)
					}
					.font(.system(size: 11, weight: .medium))
					.foregroundStyle(AppTheme.tertiaryText)
				}
				Spacer(minLength: 0)
			}

			Text(recordingSummary(recording))
				.font(.system(size: 12))
				.foregroundStyle(SettingsDesign.rowDescription)
				.lineLimit(3)
				.multilineTextAlignment(.leading)
				.frame(maxWidth: .infinity, alignment: .leading)
				.frame(minHeight: 48, alignment: .topLeading)

			HStack {
				Label(sourceText(recording.sources), systemImage: "waveform")
					.font(.system(size: 11))
					.foregroundStyle(AppTheme.secondaryText)
					.lineLimit(1)
				Spacer()
				Image(systemName: "chevron.right")
					.font(.system(size: 11, weight: .semibold))
					.foregroundStyle(AppTheme.tertiaryText)
					.accessibilityHidden(true)
			}
		}
		.padding(16)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		)
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
