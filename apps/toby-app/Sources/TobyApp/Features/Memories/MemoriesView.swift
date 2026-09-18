import SwiftUI

struct MemoriesView: View {
	@Bindable var store: MemoriesStore

	var body: some View {
		Group {
			if let errorMessage = store.errorMessage, store.memories.isEmpty, !store.isListLoading {
				ContentUnavailableView {
					Label("Memories unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else {
				MemoriesListView(store: store)
					.safeAreaInset(edge: .bottom, spacing: 0) {
						inspectorInset
					}
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
		.navigationTitle("Memories")
		.toolbarTitleDisplayMode(.inline)
		.searchable(text: searchBinding, prompt: "Search memories")
		.toolbar {
			DefaultToolbarItem(kind: .search, placement: .automatic)
			ToolbarItemGroup(placement: .primaryAction) {
				Button {
					store.startCreate()
				} label: {
					Image(systemName: "plus")
				}
				.help("New Memory")
				.disabled(store.isSaving)
				.accessibilityIdentifier("create-memory-button")
				.accessibilityLabel("New Memory")

				Button {
					Task { await store.load() }
				} label: {
					Image(systemName: "arrow.clockwise")
				}
				.help("Refresh memories")
				.disabled(store.isListLoading || store.isSaving)
				.accessibilityIdentifier("refresh-memories-button")
				.accessibilityLabel("Refresh memories")
			}
		}
		.task {
			await store.load()
			store.startPolling()
		}
		.onDisappear {
			store.stopPolling()
		}
		.sheet(item: editorSheetItem($store.editor, onDismiss: {
			store.cancelEditor()
		})) { _ in
			MemoryEditorSheet(store: store)
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

	private var searchBinding: Binding<String> {
		Binding(
			get: { store.searchQuery },
			set: { newValue in
				store.searchQuery = newValue
				Task { await store.search(newValue) }
			}
		)
	}

	private var inspectorInset: some View {
		VStack(spacing: 0) {
			if let errorMessage = store.errorMessage, !store.memories.isEmpty {
				InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
					.padding(.horizontal, 16)
					.padding(.top, 8)
			}
			MemoriesInspectorBar(store: store)
		}
	}
}
