import SwiftUI

struct MemoriesView: View {
	@Bindable var store: MemoriesStore

	var body: some View {
		MemoriesDetailView(store: store)
			.toolbarBackground(.visible)
			.background(SettingsDesign.canvasBackground)
			.task {
				await store.load()
			}
			.alert(
				"Delete Memory?",
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
					Task { await store.deleteMemory(id: pending.id) }
				}
			} message: { pending in
				Text("Are you sure you want to delete this memory? This cannot be undone.\n\n\"\(pending.value)\"")
			}
	}
}
