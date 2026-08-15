import SwiftUI

struct MemoriesView: View {
	@Bindable var store: MemoriesStore

	var body: some View {
		MemoriesDetailView(store: store)
			.toolbarBackground(.visible)
			.background(SettingsDesign.canvasBackground)
			.task {
				// Always re-fetch when the view appears so chat-side memory
				// writes (propose/save/forget) show up without a manual restart.
				await store.load()
				store.startPolling()
			}
			.onDisappear {
				store.stopPolling()
			}
			.alert(
				store.pendingDelete?.count == 1 ? "Delete Memory?" : "Delete Memories?",
				isPresented: Binding(
					get: { store.pendingDelete != nil },
					set: { if !$0 { store.pendingDelete = nil } },
				),
				presenting: store.pendingDelete,
			) { pending in
				Button("Cancel", role: .cancel) {
					store.pendingDelete = nil
				}
				Button("Delete", role: .destructive) {
					store.pendingDelete = nil
					Task { await store.deleteMemories(ids: pending.ids) }
				}
			} message: { pending in
				if pending.count == 1, let value = pending.value {
					Text("Are you sure you want to delete this memory? This cannot be undone.\n\n\"\(value)\"")
				} else {
					Text("Are you sure you want to delete \(pending.count) memories? This cannot be undone.")
				}
			}
	}
}
