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

	@State private var isSummaryScrolling = false
	@State private var summaryScrollProgress: CGFloat = 0
	@State private var summaryScrollHeight: CGFloat = 220

	private let summaryScrollbarWidth: CGFloat = 6
	private let summaryScrollbarHeight: CGFloat = 56

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

			ZStack(alignment: .trailing) {
				ScrollView(.vertical, showsIndicators: false) {
					VStack(alignment: .leading, spacing: 0) {
						MarkdownText(
							text: text,
							font: .body,
							foregroundStyle: SettingsDesign.rowTitle
						)
						.textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
						.padding(12)

						ScrollStateTracker(
							isScrolling: $isSummaryScrolling,
							progress: $summaryScrollProgress
						)
						.frame(width: 0, height: 0)
					}
				}

				if isSummaryScrolling {
					RoundedRectangle(cornerRadius: summaryScrollbarWidth / 2)
						.fill(AppTheme.tertiaryText.opacity(0.58))
						.frame(width: summaryScrollbarWidth, height: summaryScrollbarHeight)
						.padding(.trailing, 4)
						.offset(y: (summaryScrollProgress - 0.5) * max(summaryScrollHeight - summaryScrollbarHeight, 0))
						.transition(.opacity)
						.allowsHitTesting(false)
				}
			}
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
			.background(
				GeometryReader { geometry in
					Color.clear
						.onAppear { summaryScrollHeight = geometry.size.height }
						.onChange(of: geometry.size.height) { _, newValue in
							summaryScrollHeight = newValue
						}
				}
			)
			.animation(.easeInOut(duration: 0.25), value: isSummaryScrolling)
			.padding(.top, 8)
			.accessibilityIdentifier("recording-summary-section")
		}
	}

	private var transcriptSection: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text("Transcript")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Text("Read-only transcript of the recording")
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)

			ScrollView {
				Text(detail.transcript ?? detail.transcriptError ?? "Transcript not available.")
					.font(.body.monospaced())
					.foregroundStyle(detail.transcript == nil ? SettingsDesign.rowDescription : SettingsDesign.rowTitle)
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
				if let transcript = detail.transcript,
				   !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
				{
					CopyButton(text: transcript, label: "Copy transcript")
						.accessibilityIdentifier("copy-transcript-button")
						.padding(.top, 6)
						.padding(.trailing, 8)
				}
			}
			.padding(.top, 8)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}
}
