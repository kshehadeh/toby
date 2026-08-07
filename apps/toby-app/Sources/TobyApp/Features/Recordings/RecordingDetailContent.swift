import SwiftUI

struct RecordingDetailContent: View {
	@Bindable var store: RecordingsStore
	/// Snapshot of the recording detail to display. Passed as a value (not read
	/// via `store.detail!`) so body evaluation cannot crash if the store clears
	/// `detail` while this view is still briefly in the hierarchy — e.g. when
	/// an in-progress recording is auto-selected and `selectActiveRecording`
	/// nils out detail.
	let detail: ListenRecordingDetail
	var processingState: RecordingProcessingState? = nil
	var validSessionIds: Set<String> = []

	var body: some View {
		VStack(spacing: 0) {
			RecordingHeader(detail: detail)
				.padding(.horizontal, 24)
				.padding(.vertical, 18)

			Divider().overlay(SettingsDesign.cardBorder)

			HStack(spacing: 0) {
				mainColumn
				Divider().overlay(SettingsDesign.cardBorder)
				RecordingInspectorSidebar(store: store, detail: detail, processingState: processingState, validSessionIds: validSessionIds)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}

	private var mainColumn: some View {
		VStack(alignment: .leading, spacing: 16) {
			if detail.showsSummary, let summary = detail.summary,
			   !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
			{
				summarySection(text: summary)
			}
			transcriptSection
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}

	private func summarySection(text: String) -> some View {
		VStack(alignment: .leading, spacing: 4) {
			Text("Summary")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("AI-generated summary of the transcript")
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)

			ScrollView {
				MarkdownText(
					text: text,
					font: .body,
					foregroundStyle: SettingsDesign.rowTitle
				)
				.textSelection(.enabled)
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(12)
			}
			.automaticScrollIndicators(axes: .vertical)
			.frame(maxHeight: 220)
			.background(SettingsDesign.cardBackground)
			.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
			.overlay {
				RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
					.stroke(SettingsDesign.cardBorder, lineWidth: 1)
			}
			.overlay(alignment: .topTrailing) {
				CopyButton(text: text, label: "Copy summary")
					.accessibilityIdentifier("copy-summary-button")
					.padding(.top, 6)
					.padding(.trailing, 8)
			}
			.padding(.top, 8)
			.accessibilityIdentifier("recording-summary-section")
		}
	}

	private var transcriptSection: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text("Transcript")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text(transcriptCaption)
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)

			ScrollView {
				transcriptBody
					.textSelection(.enabled)
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(12)
			}
			.background(SettingsDesign.cardBackground)
			.clipShape(RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius))
			.overlay {
				RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
					.stroke(SettingsDesign.cardBorder, lineWidth: 1)
			}
			.overlay(alignment: .topTrailing) {
				if let transcript = detail.copyableTranscript {
					CopyButton(text: transcript, label: "Copy transcript")
						.accessibilityIdentifier("copy-transcript-button")
						.padding(.top, 6)
						.padding(.trailing, 8)
				}
			}
			.padding(.top, 8)
			.accessibilityIdentifier(
				detail.hasTimedSegments ? "timed-transcript-section" : "plain-transcript-section"
			)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}

	private var transcriptCaption: String {
		if detail.hasTimedSegments {
			return "Timed transcript with segment start times"
		}
		return "Read-only transcript of the recording"
	}

	@ViewBuilder
	private var transcriptBody: some View {
		if detail.hasTimedSegments {
			Text(attributedTimedTranscript(detail.timedSegments))
		} else if let transcript = detail.transcript,
		          !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
		{
			Text(transcript)
				.font(.body.monospaced())
				.foregroundStyle(SettingsDesign.rowTitle)
		} else {
			Text(detail.transcriptError ?? "Transcript not available.")
				.font(.body.monospaced())
				.foregroundStyle(SettingsDesign.rowDescription)
		}
	}
}
