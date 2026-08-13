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
	/// True while transcript / summary / audio paths are still being fetched.
	var isLoadingHeavyContent: Bool = false

	var body: some View {
		VStack(spacing: 0) {
			RecordingHeader(detail: detail)
				.padding(.horizontal, 24)
				.padding(.vertical, 18)

			Divider().overlay(SettingsDesign.cardBorder)

			HStack(spacing: 0) {
				mainColumn
				Divider().overlay(SettingsDesign.cardBorder)
				RecordingInspectorSidebar(
					store: store,
					detail: detail,
					processingState: processingState,
					validSessionIds: validSessionIds,
					isLoadingHeavyContent: isLoadingHeavyContent,
				)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}

	private var mainColumn: some View {
		VStack(alignment: .leading, spacing: 16) {
			if isLoadingHeavyContent && detail.showsSummary && !detail.hasLoadedSummaryBody {
				summarySkeleton
			} else if detail.showsSummary, let summary = detail.summary,
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
				if !isLoadingTranscript, let transcript = detail.copyableTranscript {
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

	private var isLoadingTranscript: Bool {
		isLoadingHeavyContent && detail.hasTranscript && !detail.hasLoadedTranscriptBody
	}

	private var summarySkeleton: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text("Summary")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("AI-generated summary of the transcript")
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)
			RecordingBlockSkeleton(lineCount: 5, accessibilityIdentifier: "recording-summary-skeleton")
				.padding(.top, 8)
		}
	}

	@ViewBuilder
	private var transcriptBody: some View {
		if isLoadingTranscript {
			RecordingBlockSkeleton(lineCount: 14, accessibilityIdentifier: "recording-transcript-skeleton")
		} else if detail.hasTimedSegments {
			// Lazy rows so a long timed transcript does not build one giant attributed string.
			LazyVStack(alignment: .leading, spacing: 6) {
				ForEach(Array(detail.timedSegments.enumerated()), id: \.offset) { _, segment in
					TimedTranscriptLine(segment: segment)
				}
			}
		} else if let transcript = detail.transcript,
			!transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
		{
			LazyVStack(alignment: .leading, spacing: 4) {
				ForEach(Array(transcript.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).enumerated()), id: \.offset) { _, line in
					Text(line.isEmpty ? " " : String(line))
						.font(.body.monospaced())
						.foregroundStyle(SettingsDesign.rowTitle)
						.frame(maxWidth: .infinity, alignment: .leading)
						.textSelection(.enabled)
				}
			}
		} else {
			Text(detail.transcriptError ?? "Transcript not available.")
				.font(.body.monospaced())
				.foregroundStyle(SettingsDesign.rowDescription)
		}
	}
}

private struct TimedTranscriptLine: View {
	let segment: ListenTranscriptSegment

	var body: some View {
		HStack(alignment: .firstTextBaseline, spacing: 8) {
			Text("[\(playbackTimeText(segment.timestamp))]")
				.font(.body.monospaced())
				.foregroundStyle(SettingsDesign.rowDescription)
			Text(segment.text.trimmingCharacters(in: .whitespacesAndNewlines))
				.font(.body.monospaced())
				.foregroundStyle(SettingsDesign.rowTitle)
				.textSelection(.enabled)
				.frame(maxWidth: .infinity, alignment: .leading)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}
