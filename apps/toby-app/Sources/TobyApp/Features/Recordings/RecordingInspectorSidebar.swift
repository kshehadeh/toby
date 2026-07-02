import SwiftUI

struct RecordingInspectorSidebar: View {
	@Bindable var store: RecordingsStore
	let detail: ListenRecordingDetail

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

	private func startChatAboutRecording() {
		let (dateText, hourText) = recordingChatDateAndHour(detail)
		NotificationCenter.default.post(
			name: .startChatAboutRecording,
			object: StartChatAboutRecordingRequest(
				name: detail.metadata.name ?? "Recording",
				dateText: dateText,
				hourText: hourText,
			),
		)
	}

	var body: some View {
		VStack(spacing: 0) {
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
				.padding(18)
				.frame(maxWidth: .infinity, alignment: .leading)
			}

			Divider().overlay(SettingsDesign.cardBorder)

			HStack(spacing: 10) {
				Button {
					startChatAboutRecording()
				} label: {
					Label("Start Chat", systemImage: "bubble.left.and.bubble.right")
						.frame(maxWidth: .infinity)
				}
				.buttonStyle(.borderedProminent)
				.controlSize(.regular)
				.accessibilityIdentifier("sidebar-start-chat-button")

				Button(role: .destructive) {
					store.pendingDeleteRecordingIds = [detail.id]
				} label: {
					Label("Delete…", systemImage: "trash")
						.frame(maxWidth: .infinity)
				}
				.buttonStyle(.bordered)
				.controlSize(.regular)
				.tint(.red)
				.accessibilityIdentifier("sidebar-delete-recording-button")
			}
			.padding(18)
		}
		.frame(width: 280)
		.background(AppTheme.sidebarBackground)
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
			if detail.hasAudio, detail.audioPath != nil {
				RecordingAudioPlayerView(detail: detail)
			} else {
				Text("No audio file available")
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
			Text(visibleErrors.joined(separator: "\n"))
				.font(.system(size: 11))
				.foregroundStyle(.red.opacity(0.85))
				.textSelection(.enabled)
				.fixedSize(horizontal: false, vertical: true)
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
