import SwiftUI

struct RecordingInspectorSidebar: View {
	@Bindable var store: RecordingsStore
	let detail: ListenRecordingDetail
	var processingState: RecordingProcessingState? = nil
	var isLoadingHeavyContent: Bool = false

	@State private var nameText = ""
	@State private var saveTask: Task<Void, Never>?
	@FocusState private var nameFieldFocused: Bool

	private var visibleErrors: [String] {
		(detail.metadata.errors ?? []).filter { !isNonFatalScreenCaptureDecline($0) }
	}

	private var recordingStatusText: String {
		if detail.hasTranscript { return "Transcribed" }
		if detail.hasAudio { return "Recorded" }
		return "Saved"
	}

	/// True when the selected recording is actively being transcribed (either
	/// via the manual Transcribe/Re-Transcribe button or the post-recording flow).
	private var isTranscribing: Bool {
		guard let state = processingState,
			state.recordingId == detail.id,
			state.isActive else { return false }
		return true
	}

	private var isSummarizing: Bool {
		store.summarizingRecordingId == detail.id
	}

	private var isDeletingAudio: Bool {
		store.deletingAudioRecordingId == detail.id
	}

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 18) {
				nameSection
				Divider().overlay(SettingsDesign.cardBorder)
				metadataSection
				Divider().overlay(SettingsDesign.cardBorder)
				audioSection
				Divider().overlay(SettingsDesign.cardBorder)
				transcriptionSection
				if !visibleErrors.isEmpty {
					Divider().overlay(SettingsDesign.cardBorder)
					errorsSection
				}
			}
			.padding(18)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.frame(width: 280)
		.background(AppTheme.sidebarBackground)
		.alert(
			"Delete Audio?",
			isPresented: Binding(
				get: { store.pendingDeleteAudioRecordingId == detail.id },
				set: { if !$0 { store.pendingDeleteAudioRecordingId = nil } }
			)
		) {
			Button("Cancel", role: .cancel) {
				store.pendingDeleteAudioRecordingId = nil
			}
			Button("Delete Audio", role: .destructive) {
				store.pendingDeleteAudioRecordingId = nil
				Task { await store.deleteRecordingAudio(id: detail.id) }
			}
		} message: {
			Text("The audio files are deleted. The transcript, summary, and recording entry are kept. This cannot be undone.")
		}
	}

	@ViewBuilder
	private var nameSection: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Name")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			TextField("Recording name", text: $nameText)
				.textFieldStyle(.roundedBorder)
				.font(.system(size: 13))
				.focused($nameFieldFocused)
				.onChange(of: nameText) { _, _ in scheduleSave() }
				.onChange(of: nameFieldFocused) { _, focused in
					if !focused { saveNow() }
				}
				.accessibilityIdentifier("recording-name-field")
		}
		.onAppear { nameText = detail.metadata.name ?? "" }
		.onChange(of: detail.id) { _, _ in
			saveTask?.cancel()
			nameText = detail.metadata.name ?? ""
		}
		.onChange(of: detail.metadata.name) { _, newValue in
			if !nameFieldFocused { nameText = newValue ?? "" }
		}
	}

	private func scheduleSave() {
		saveTask?.cancel()
		saveTask = Task {
			try? await Task.sleep(for: .milliseconds(600))
			guard !Task.isCancelled else { return }
			await saveName()
		}
	}

	private func saveNow() {
		saveTask?.cancel()
		saveTask = nil
		Task { await saveName() }
	}

	private func saveName() async {
		let trimmed = nameText.trimmingCharacters(in: .whitespacesAndNewlines)
		let current = detail.metadata.name ?? ""
		guard trimmed != current else { return }
		await store.renameRecording(id: detail.id, name: trimmed)
	}

	private var metadataSection: some View {
		VStack(alignment: .leading, spacing: 10) {
			metadataRow(label: "Started", value: friendlyRecordingDate(detail.metadata.startedAt, fallback: detail.metadata.createdAt))
			metadataRow(label: "Duration", value: durationText(detail.metadata.durationMs))
			metadataRow(label: "Sources", value: sourceText(detail.metadata.sources))
			metadataRow(label: "Status", value: recordingStatusText)
			metadataRow(label: "Location", value: detail.dir)
		}
	}

	private var audioSection: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("Audio")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			if isLoadingHeavyContent && detail.hasAudio && !detail.hasLoadedAudioPaths {
				RecordingAudioPlayerSkeleton()
			} else if detail.hasAudio, !detail.playableAudioSources.isEmpty {
				RecordingAudioPlayerView(detail: detail)
			} else {
				Text(
					detail.metadata.audioDeletedAt == nil
						? "No audio file available"
						: "Audio deleted; the transcript is kept."
				)
				.font(.system(size: 11))
				.foregroundStyle(SettingsDesign.rowDescription)
			}

			if detail.hasAudio {
				Button {
					store.pendingDeleteAudioRecordingId = detail.id
				} label: {
					Label("Delete Audio", systemImage: "trash")
						.frame(maxWidth: .infinity)
				}
				.buttonStyle(.bordered)
				.controlSize(.small)
				.tint(.red)
				.disabled(isDeletingAudio)
				.accessibilityIdentifier("sidebar-delete-audio-button")
			}
		}
	}

	@ViewBuilder
	private var transcriptionSection: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("Transcription")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)

			if isTranscribing {
				HStack(spacing: 8) {
					ProgressView()
						.scaleEffect(0.7)
					Text(processingState?.message ?? "Transcribing…")
						.font(.system(size: 11))
						.foregroundStyle(SettingsDesign.rowDescription)
				}
			} else if detail.hasTranscript {
				Text("Transcript available")
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
			} else {
				Text("No transcript yet")
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
			}

			Button {
				Task { await store.transcribeRecording(id: detail.id) }
			} label: {
				Label(
					detail.hasTranscript ? "Re-Transcribe" : "Transcribe",
					systemImage: "waveform.badge.magnifyingglass"
				)
				.frame(maxWidth: .infinity)
			}
			.buttonStyle(.bordered)
			.controlSize(.small)
			.disabled(isTranscribing || isSummarizing || !detail.hasAudio)
			.accessibilityIdentifier("sidebar-transcribe-button")

			if detail.hasTranscript {
				if isSummarizing {
					HStack(spacing: 8) {
						ProgressView()
							.scaleEffect(0.7)
						Text("Summarizing…")
							.font(.system(size: 11))
							.foregroundStyle(SettingsDesign.rowDescription)
					}
				} else if detail.showsSummary {
					Text("Summary available")
						.font(.system(size: 11))
						.foregroundStyle(SettingsDesign.rowDescription)
				}

				Button {
					Task { await store.summarizeRecording(id: detail.id) }
				} label: {
					Label(
						detail.showsSummary ? "Re-Summarize" : "Summarize",
						systemImage: "text.badge.star"
					)
					.frame(maxWidth: .infinity)
				}
				.buttonStyle(.bordered)
				.controlSize(.small)
				.disabled(isTranscribing || isSummarizing)
				.accessibilityIdentifier("sidebar-summarize-button")
			}
		}
	}

	@ViewBuilder
	private var errorsSection: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Errors")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			InlineStatusMessage(
				message: visibleErrors.joined(separator: "\n"),
				tone: .error,
				font: .system(size: 11),
				allowsTextSelection: true
			)
		}
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
