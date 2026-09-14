import SwiftUI

enum RecordingDetailTab: String, Hashable, CaseIterable {
	case summary
	case transcript
}

struct RecordingDetailContent: View {
	@Bindable var store: RecordingsStore
	/// Snapshot of the recording detail to display. Passed as a value (not read
	/// via `store.detail!`) so body evaluation cannot crash if the store clears
	/// `detail` while this view is still briefly in the hierarchy — e.g. when
	/// an in-progress recording is auto-selected and `selectActiveRecording`
	/// nils out detail.
	let detail: ListenRecordingDetail
	var processingState: RecordingProcessingState? = nil
	/// True while transcript / summary / audio paths are still being fetched.
	var isLoadingHeavyContent: Bool = false

	var body: some View {
		TabView(selection: $store.selectedDetailTab) {
			Tab(value: RecordingDetailTab.summary) {
				RecordingSummaryPane(
					store: store,
					detail: detail,
					processingState: processingState,
					isLoadingHeavyContent: isLoadingHeavyContent
				)
			} label: {
				Text("Summary")
			}
			Tab(value: RecordingDetailTab.transcript) {
				RecordingTranscriptPane(
					detail: detail,
					isLoadingHeavyContent: isLoadingHeavyContent
				)
			} label: {
				Text("Transcript")
			}
		}
		.padding(AppTheme.contentPadding)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.accessibilityIdentifier("recording-detail-tabs")
	}
}

struct RecordingSummaryPane: View {
	@Bindable var store: RecordingsStore
	let detail: ListenRecordingDetail
	var processingState: RecordingProcessingState? = nil
	var isLoadingHeavyContent: Bool = false

	private var isTranscribing: Bool {
		guard let state = processingState,
			state.recordingId == detail.id,
			state.isActive else { return false }
		return true
	}

	private var isSummarizing: Bool {
		store.summarizingRecordingId == detail.id
	}

	var body: some View {
		Group {
			if isSummarizing {
				summarizingPlaceholder
			} else if isLoadingHeavyContent && detail.showsSummary && !detail.hasLoadedSummaryBody {
				summarySkeleton
			} else if detail.showsSummary, let summary = detail.summary,
				!summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
			{
				summarySection(text: summary)
			} else {
				emptySummary
			}
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("recording-summary-tab")
	}

	private func summarySection(text: String) -> some View {
		VStack(alignment: .leading, spacing: 4) {
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
			.frame(maxWidth: .infinity, maxHeight: .infinity)
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
			.padding(.top, 4)
			.accessibilityIdentifier("recording-summary-section")
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}

	private var emptySummary: some View {
		ContentUnavailableView {
			Label {
				Text("No summary")
			} icon: {
				Image(systemName: "text.badge.star")
					.accessibilityHidden(true)
			}
		} description: {
			Text("There is no summary for this recording yet.")
		} actions: {
			Button("Summarize") {
				store.selectedDetailTab = .summary
				Task { await store.summarizeRecording(id: detail.id) }
			}
			.buttonStyle(.link)
			.disabled(!detail.hasTranscript || isSummarizing || isTranscribing)
			.help(
				detail.hasTranscript
					? "Summarize this recording"
					: "Transcribe this recording first"
			)
			.accessibilityIdentifier("empty-summary-summarize-link")
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.accessibilityIdentifier("recording-summary-empty")
	}

	private var summarizingPlaceholder: some View {
		VStack(spacing: 12) {
			ProgressView()
				.controlSize(.small)
			Text("Summarizing…")
				.font(.system(size: 13))
				.foregroundStyle(SettingsDesign.rowDescription)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.accessibilityIdentifier("recording-summary-summarizing")
	}

	private var summarySkeleton: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text("AI-generated summary of the transcript")
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)
			RecordingBlockSkeleton(lineCount: 5, accessibilityIdentifier: "recording-summary-skeleton")
				.padding(.top, 4)
		}
	}
}

struct RecordingTranscriptPane: View {
	let detail: ListenRecordingDetail
	var isLoadingHeavyContent: Bool = false

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
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
			.padding(.top, 4)
			.accessibilityIdentifier(
				detail.hasTimedSegments ? "timed-transcript-section" : "plain-transcript-section"
			)
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("recording-transcript-tab")
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
