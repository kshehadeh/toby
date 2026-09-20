import SwiftUI

struct RecordingEditSheet: View {
	@Bindable var store: RecordingsStore
	let detail: ListenRecordingDetail
	var isLoadingHeavyContent: Bool = false

	@State private var nameText = ""
	@State private var didLoadDraft = false

	private var visibleErrors: [String] {
		(detail.metadata.errors ?? []).filter { !isNonFatalScreenCaptureDecline($0) }
	}

	private var recordingStatusText: String {
		if detail.hasTranscript { return "Transcribed" }
		if detail.hasAudio { return "Recorded" }
		return "Saved"
	}

	private var currentName: String {
		detail.metadata.name ?? ""
	}

	private var trimmedName: String {
		nameText.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	private var isDirty: Bool {
		trimmedName != currentName
	}

	var body: some View {
		EditorSheet(
			title: "Edit Recording",
			isSaving: false,
			canSave: true,
			isDirty: isDirty,
			size: .compact,
			accessibilityIdentifier: "recording-edit-sheet",
			cancelAccessibilityIdentifier: "recording-edit-cancel-button",
			saveAccessibilityIdentifier: "recording-edit-save-button",
			onCancel: {
				store.isEditSheetPresented = false
			},
			onSave: {
				Task { await saveAndDismiss() }
			}
		) {
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
		}
		.onAppear {
			if !didLoadDraft {
				nameText = currentName
				didLoadDraft = true
			}
		}
		.onChange(of: detail.id) { _, _ in
			nameText = currentName
			didLoadDraft = true
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
				.accessibilityIdentifier("recording-name-field")
		}
	}

	private var metadataSection: some View {
		DetailMetadataStack {
			DetailMetadataRow(
				label: "Started",
				value: friendlyRecordingDate(detail.metadata.startedAt, fallback: detail.metadata.createdAt)
			)
			DetailMetadataRow(label: "Duration", value: durationText(detail.metadata.durationMs))
			DetailMetadataRow(label: "Sources", value: sourceText(detail.metadata.sources))
			DetailMetadataRow(label: "Status", value: recordingStatusText)
			DetailMetadataRow(label: "Location", value: detail.dir, monospaced: true)
		}
	}

	private var audioSection: some View {
		DetailSection(title: "Audio") {
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
		DetailSection(title: "Errors") {
			InlineStatusMessage(
				message: visibleErrors.joined(separator: "\n"),
				tone: .error,
				font: .system(size: 11),
				allowsTextSelection: true
			)
		}
	}

	private func saveAndDismiss() async {
		if isDirty {
			await store.renameRecording(id: detail.id, name: trimmedName)
		}
		store.isEditSheetPresented = false
	}
}
