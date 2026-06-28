import SwiftUI

struct RecordingsView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil

	var body: some View {
		RecordingsDetailView(store: store, processingState: processingState, onDeleteSelectedRecordings: {
			store.pendingDeleteRecordingIds = Set(store.selectedRecordings.map(\.id))
		})
		.toolbarBackground(.visible)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.load()
		}
		.onChange(of: processingState?.stage) { _, newStage in
			if newStage == .complete || newStage == .failed {
				Task {
					await store.load()
					if let id = processingState?.recordingId {
						await store.selectRecording(id: id)
					}
				}
			}
		}
		.alert(
			"Delete \(store.pendingDeleteRecordingIds.count == 1 ? "Recording" : "Recordings")?",
			isPresented: Binding(
				get: { !store.pendingDeleteRecordingIds.isEmpty },
				set: { if !$0 { store.pendingDeleteRecordingIds = [] } },
			),
			presenting: store.pendingDeleteRecordingIds,
		) { ids in
			Button("Cancel", role: .cancel) {
				store.pendingDeleteRecordingIds = []
			}
			Button("Delete", role: .destructive) {
				store.pendingDeleteRecordingIds = []
				Task { await store.deleteRecordings(ids: Array(ids)) }
			}
		} message: { ids in
			if ids.count == 1, let id = ids.first, let recording = store.recordings.first(where: { $0.id == id }) {
				Text("Are you sure you want to delete \"\(recordingSidebarTitle(recording))\"? This cannot be undone.")
			} else {
				Text("Are you sure you want to delete \(ids.count) recordings? This cannot be undone.")
			}
		}
	}
}
