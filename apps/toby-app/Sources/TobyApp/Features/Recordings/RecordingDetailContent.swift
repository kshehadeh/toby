import SwiftUI

struct RecordingDetailContent: View {
	@Bindable var store: RecordingsStore
	var recordingId: String?

	@State private var isEditingName = false
	@State private var nameDraft = ""
	@FocusState private var nameFieldFocused: Bool

	private var detail: ListenRecordingDetail { store.detail! }

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
		VStack(alignment: .leading, spacing: 28) {
			if isEditingName {
				RecordingNameEditor(
					draft: $nameDraft,
					isFocused: $nameFieldFocused,
					onSave: {
						guard let id = recordingId else { return }
						let newName = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
						isEditingName = false
						Task { await store.renameRecording(id: id, name: newName) }
					},
					onCancel: {
						isEditingName = false
						nameDraft = detail.metadata.name ?? ""
					},
				)
			} else {
				VStack(alignment: .leading, spacing: 8) {
					HStack(spacing: 12) {
						Text(detail.metadata.name ?? "Recording")
							.font(.title2.weight(.semibold))
							.foregroundStyle(AppTheme.primaryText)

						Button {
							nameDraft = detail.metadata.name ?? ""
							isEditingName = true
							nameFieldFocused = true
						} label: {
							Image(systemName: "pencil")
								.font(.body)
								.foregroundStyle(AppTheme.secondaryText)
						}
						.buttonStyle(.plain)
						.accessibilityIdentifier("rename-recording-button")

						Spacer()

						Button {
							startChatAboutRecording()
						} label: {
							Label("Start Chat", systemImage: "bubble.left.and.bubble.right")
						}
						.buttonStyle(.borderedProminent)
						.accessibilityIdentifier("start-chat-button")
					}

					HStack(spacing: 6) {
						Text(friendlyRecordingDate(detail.metadata.startedAt, fallback: detail.metadata.createdAt))
							.font(.subheadline)
							.foregroundStyle(AppTheme.secondaryText)

						if detail.hasTranscript {
							HStack(spacing: 4) {
								Circle()
									.fill(Color.orange)
									.frame(width: 6, height: 6)
								Text("Transcribed")
									.font(.caption.weight(.medium))
									.foregroundStyle(Color.orange)
							}
							.padding(.horizontal, 8)
							.padding(.vertical, 3)
							.background(Color.orange.opacity(0.12))
							.clipShape(Capsule())
						}
					}
				}
			}

			VStack(alignment: .leading, spacing: 10) {
				Text("Recording")
					.font(.subheadline.weight(.medium))
					.foregroundStyle(SettingsDesign.sectionHeader)

				let columns = [GridItem(.flexible()), GridItem(.flexible())]
				LazyVGrid(columns: columns, spacing: 10) {
					RecordingInfoCard(
						label: "Started",
						value: friendlyRecordingDate(detail.metadata.startedAt, fallback: detail.metadata.createdAt),
					)
					RecordingInfoCard(label: "Duration", value: durationText(detail.metadata.durationMs))
					RecordingInfoCard(label: "Sources", value: sourceText(detail.metadata.sources))
					RecordingInfoCard(label: "Status", value: recordingStatusText)
				}

				RecordingInfoCard(label: "Location", value: detail.dir)
			}

			VStack(alignment: .leading, spacing: 10) {
				Text("Audio")
					.font(.subheadline.weight(.medium))
					.foregroundStyle(SettingsDesign.sectionHeader)

				SettingsCard {
					RecordingAudioPlayerView(detail: detail)
				}
			}

			VStack(alignment: .leading, spacing: 10) {
				Text("Transcript")
					.font(.subheadline.weight(.medium))
					.foregroundStyle(SettingsDesign.sectionHeader)

				SettingsCard {
					Text(detail.transcript ?? detail.transcriptError ?? "Transcript not available.")
						.font(.body.monospaced())
						.foregroundStyle(detail.transcript == nil ? SettingsDesign.rowDescription : SettingsDesign.rowTitle)
						.textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
						.padding(SettingsDesign.rowHorizontalPadding)
						.padding(.vertical, SettingsDesign.rowVerticalPadding)
				}
				.overlay(alignment: .topTrailing) {
					if let transcript = detail.transcript,
					   !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
					{
						CopyButton(text: transcript, label: "Copy transcript")
							.accessibilityIdentifier("copy-transcript-button")
							.padding(.top, 6)
							.padding(.trailing, 8)
					}
				}
			}

			if !visibleErrors.isEmpty {
				VStack(alignment: .leading, spacing: 10) {
					Text("Errors")
						.font(.subheadline.weight(.medium))
						.foregroundStyle(SettingsDesign.sectionHeader)

					SettingsCard {
						Text(visibleErrors.joined(separator: "\n"))
							.font(.subheadline)
							.foregroundStyle(.red.opacity(0.85))
							.textSelection(.enabled)
							.frame(maxWidth: .infinity, alignment: .leading)
							.padding(SettingsDesign.rowHorizontalPadding)
							.padding(.vertical, SettingsDesign.rowVerticalPadding)
					}
				}
			}
		}
	}
}
