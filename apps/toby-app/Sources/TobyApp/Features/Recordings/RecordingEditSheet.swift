import SwiftUI

struct RecordingEditSheet: View {
	@Bindable var store: RecordingsStore
	let detail: ListenRecordingDetail
	var isLoadingHeavyContent: Bool = false
	@Environment(\.dismiss) private var dismiss

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

	var body: some View {
		NavigationStack {
			ScrollView {
				VStack(alignment: .leading, spacing: 18) {
					nameSection
					Divider().overlay(SettingsDesign.cardBorder)
					metadataSection
					Divider().overlay(SettingsDesign.cardBorder)
					audioSection
					if !visibleErrors.isEmpty {
						Divider().overlay(SettingsDesign.cardBorder)
						errorsSection
					}
				}
				.padding(20)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
			.background(SettingsDesign.canvasBackground)
			.navigationTitle("Edit Recording")
			.toolbar {
				ToolbarItem(placement: .confirmationAction) {
					Button("Done") {
						saveNow()
						dismiss()
					}
					.keyboardShortcut(.defaultAction)
					.accessibilityIdentifier("recording-edit-done-button")
				}
			}
		}
		.frame(minWidth: 420, idealWidth: 460, minHeight: 480, idealHeight: 560)
		.accessibilityIdentifier("recording-edit-sheet")
		.onDisappear { saveNow() }
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
