import SwiftUI

struct RecordingsView: View {
	@Bindable var store: RecordingsStore

	var body: some View {
		NavigationSplitView {
			RecordingsSidebarView(store: store)
				.navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)
		} detail: {
			RecordingsDetailView(store: store)
		}
		.frame(minWidth: 860, minHeight: 560)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.load()
		}
	}
}

private struct RecordingsSidebarView: View {
	@Bindable var store: RecordingsStore

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 2) {
				if store.isLoading && store.recordings.isEmpty {
					Text("Loading recordings...")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(10)
				} else if store.recordings.isEmpty {
					Text("No recordings")
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.padding(10)
				} else {
					ForEach(store.recordings) { recording in
						Button {
							Task { await store.selectRecording(id: recording.id) }
						} label: {
							RecordingSidebarRow(
								recording: recording,
								isSelected: recording.id == store.selectedRecordingId,
							)
						}
						.buttonStyle(.plain)
					}
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(10)
		}
		.background(AppTheme.sidebarBackground)
	}
}

private struct RecordingSidebarRow: View {
	let recording: ListenRecordingSummary
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 8) {
			Image(systemName: recording.hasTranscript ? "doc.text" : "waveform")
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
				.frame(width: 18)
			VStack(alignment: .leading, spacing: 3) {
				Text(recording.displayName)
					.font(.callout)
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				Text(recordingSummary(recording))
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 7)
		.padding(.horizontal, 8)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
				.fill(isSelected ? SettingsDesign.sidebarSelection : Color.clear)
		)
	}
}

private struct RecordingsDetailView: View {
	@Bindable var store: RecordingsStore

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				if store.isDetailLoading && store.detail == nil {
					ProgressView("Loading recording...")
						.frame(maxWidth: .infinity, minHeight: 240)
				} else if let detail = store.detail {
					RecordingDetailContent(detail: detail)
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

				if let errorMessage = store.errorMessage, store.detail != nil {
					Text(errorMessage)
						.font(.caption)
						.foregroundStyle(.red)
				}
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth)
			.frame(maxWidth: .infinity)
			.padding(.horizontal, 32)
			.padding(.vertical, 28)
		}
		.background(SettingsDesign.canvasBackground)
	}
}

private struct RecordingDetailContent: View {
	let detail: ListenRecordingDetail

	private var visibleErrors: [String] {
		(detail.metadata.errors ?? []).filter { !isNonFatalScreenCaptureDecline($0) }
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 20) {
			SettingsSectionHeader(title: detail.metadata.name ?? "Recording")
			SettingsCard {
				SettingsRow(title: "Started", description: detail.metadata.startedAt) {
					EmptyView()
				}
				SettingsRow(title: "Duration", description: durationText(detail.metadata.durationMs)) {
					EmptyView()
				}
				SettingsRow(title: "Sources", description: sourceText(detail.metadata.sources)) {
					EmptyView()
				}
				SettingsRow(title: "Location", description: detail.dir, showsDivider: false) {
					EmptyView()
				}
			}

			SettingsSectionHeader(title: "Transcript")
			SettingsCard {
				Text(detail.transcript ?? detail.transcriptError ?? "Transcript not available.")
					.font(.body.monospaced())
					.foregroundStyle(detail.transcript == nil ? SettingsDesign.rowDescription : SettingsDesign.rowTitle)
					.textSelection(.enabled)
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(SettingsDesign.rowHorizontalPadding)
			}

			if !visibleErrors.isEmpty {
				SettingsSectionHeader(title: "Errors")
				SettingsCard {
					Text(visibleErrors.joined(separator: "\n"))
						.font(.subheadline)
						.foregroundStyle(.red.opacity(0.85))
						.textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
						.padding(SettingsDesign.rowHorizontalPadding)
				}
			}
		}
	}
}

private func isNonFatalScreenCaptureDecline(_ message: String) -> Bool {
	message.contains("SCStreamErrorDomain")
		&& message.contains("Code=-3801")
		&& message.localizedCaseInsensitiveContains("declined")
}

private func recordingSummary(_ recording: ListenRecordingSummary) -> String {
	let duration = durationText(recording.durationMs)
	return recording.hasTranscript ? "\(duration) · Transcript" : duration
}

private func durationText(_ durationMs: Int?) -> String {
	guard let durationMs else { return "Unknown duration" }
	let seconds = max(0, durationMs / 1000)
	let minutes = seconds / 60
	let remainder = seconds % 60
	return "\(minutes):\(String(format: "%02d", remainder))"
}

private func sourceText(_ sources: ListenSourceSelection) -> String {
	switch (sources.mic, sources.system) {
	case (true, true):
		return "Microphone + System audio"
	case (true, false):
		return "Microphone"
	case (false, true):
		return "System audio"
	default:
		return "None"
	}
}
