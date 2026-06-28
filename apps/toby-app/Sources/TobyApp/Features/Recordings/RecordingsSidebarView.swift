import AppKit
import SwiftUI

struct RecordingsSidebarView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil
	let onDeleteRecording: (ListenRecordingSummary) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("Recordings")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 8)
				.padding(.top, 10)
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
							let holdingCommand = NSApp.currentEvent?.modifierFlags.contains(.command) ?? false
							Task { await store.selectRecording(id: recording.id, holdingCommand: holdingCommand) }
						} label: {
							RecordingSidebarRow(
								recording: recording,
								isSelected: store.selectedRecordingIds.contains(recording.id),
								isProcessing: processingState?.recordingId == recording.id && processingState?.isActive == true,
								processingStage: processingState?.recordingId == recording.id ? processingState?.stage : nil,
							)
						}
						.buttonStyle(.plain)
						.contextMenu {
							Button("Delete Recording", systemImage: "trash", role: .destructive) {
								onDeleteRecording(recording)
							}
						}
					}
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(10)
		}
		.background(AppTheme.sidebarBackground)
	}
}
}
