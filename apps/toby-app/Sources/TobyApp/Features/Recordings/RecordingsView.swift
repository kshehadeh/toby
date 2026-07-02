import SwiftUI

struct RecordingsView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil

	/// Effective processing state: prefer the store's manual transcription
	/// state when active, otherwise fall back to the post-recording state.
	private var effectiveProcessingState: RecordingProcessingState? {
		if let manual = store.transcriptionProcessing, manual.isActive {
			return manual
		}
		return processingState
	}

	var body: some View {
		RecordingsDetailView(store: store, processingState: effectiveProcessingState)
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
		.onChange(of: store.transcriptionProcessing?.stage) { _, newStage in
			if newStage == .complete || newStage == .failed {
				// Clear the manual processing state after a short delay so the
				// processing card disappears once the reload completes.
				Task {
					try? await Task.sleep(for: .milliseconds(500))
					if store.transcriptionProcessing?.isActive == false {
						store.transcriptionProcessing = nil
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
