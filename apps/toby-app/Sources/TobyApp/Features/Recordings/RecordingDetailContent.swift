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
				transcriptColumn
				Divider().overlay(SettingsDesign.cardBorder)
				RecordingInspectorSidebar(store: store, detail: detail, processingState: processingState, validSessionIds: validSessionIds)
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}

	private var transcriptColumn: some View {
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
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
	}
}
