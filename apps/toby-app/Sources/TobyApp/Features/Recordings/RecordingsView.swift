import SwiftUI

struct RecordingsView: View {
	@Bindable var store: RecordingsStore
	var processingState: RecordingProcessingState? = nil
	var validSessionIds: Set<String> = []
	var onStartRecording: (() -> Void)? = nil
	var onStopRecording: (() -> Void)? = nil
	var activeRecording: ActiveRecordingInfo? = nil

	/// Effective processing state: prefer the store's manual transcription
	/// state when active, otherwise fall back to the post-recording state.
	private var effectiveProcessingState: RecordingProcessingState? {
		if let manual = store.transcriptionProcessing, manual.isActive {
			return manual
		}
		return processingState
	}

	var body: some View {
		RecordingsDetailView(store: store, processingState: effectiveProcessingState, validSessionIds: validSessionIds, onStartRecording: onStartRecording, onStopRecording: onStopRecording, activeRecording: activeRecording)
		.toolbarBackground(.visible)
		.background(SettingsDesign.canvasBackground)
		.task {
			await store.ensureLoaded()
			// If a recording is already in progress when the view appears,
			// auto-select it so the detail is visible immediately.
			if let active = activeRecording, store.selectedActiveRecordingId == nil {
				store.selectActiveRecording(id: active.id)
			}
		}
		// Post-recording list refresh is owned by RootView so it also runs when
		// this route is not mounted. Manual re-transcribe still reloads detail
		// via RecordingsStore.transcribeRecording.
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
		.onChange(of: activeRecording?.id) { _, newID in
			if let newID {
				// Auto-select the active recording so its detail is visible
				// immediately when a recording starts.
				store.selectActiveRecording(id: newID)
			} else {
				// Clear stale active selection when recording stops.
				store.selectedActiveRecordingId = nil
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
