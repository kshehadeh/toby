import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
	@Bindable var store: LibraryStore
	@State private var quickLookURL: URL?

	var body: some View {
		Group {
			if let errorMessage = store.errorMessage, store.items.isEmpty, !store.isListLoading {
				ContentUnavailableView {
					Label("Library unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else {
				LibraryListView(store: store, onQuickLook: previewItem)
					.safeAreaInset(edge: .bottom, spacing: 0) {
						inspectorInset
					}
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
		.searchable(text: searchBinding, prompt: "Search library")
		.fileImporter(
			isPresented: $store.isImporterPresented,
			allowedContentTypes: LibraryStore.acceptedContentTypes,
			allowsMultipleSelection: true
		) { result in
			switch result {
			case .success(let urls):
				Task { await store.importFiles(urls: urls) }
			case .failure(let error):
				store.importerError = error.localizedDescription
				store.errorMessage = error.localizedDescription
			}
		}
		.quickLookPreview($quickLookURL)
		.task {
			await store.load()
			store.startPolling()
		}
		.onDisappear {
			store.stopPolling()
		}
		.alert(
			store.pendingDelete?.count == 1 ? "Delete Library Item?" : "Delete Library Items?",
			isPresented: Binding(
				get: { store.pendingDelete != nil },
				set: { if !$0 { store.pendingDelete = nil } }
			),
			presenting: store.pendingDelete
		) { pending in
			Button("Cancel", role: .cancel) {
				store.pendingDelete = nil
			}
			Button("Delete", role: .destructive) {
				store.pendingDelete = nil
				Task { await store.deleteItems(ids: pending.ids) }
			}
		} message: { pending in
			if pending.count == 1, let title = pending.title {
				Text("Are you sure you want to delete “\(title)” from the library? The stored file will be removed. This cannot be undone.")
			} else {
				Text("Are you sure you want to delete \(pending.count) library items? Stored files will be removed. This cannot be undone.")
			}
		}
		.accessibilityIdentifier("library-view")
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
			if let errorMessage = store.errorMessage, !store.items.isEmpty {
				InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
					.padding(.horizontal, 16)
					.padding(.top, 8)
			}
			LibraryInspectorBar(
				store: store,
				onQuickLook: previewSelected,
				onReveal: revealSelected
			)
		}
	}

	private func previewSelected() {
		guard let item = store.inspectedItem else { return }
		previewItem(item)
	}

	private func previewItem(_ item: LibraryAsset) {
		FileQuickLook.previewOrOpen(path: item.absolutePath) { url in
			quickLookURL = url
		}
	}

	private func revealSelected() {
		guard let item = store.inspectedItem else { return }
		RevealInFinder.reveal(path: item.absolutePath)
	}
}

struct LibraryListView: View {
	@Bindable var store: LibraryStore
	var onQuickLook: (LibraryAsset) -> Void = { _ in }

	var body: some View {
		if store.items.isEmpty, !store.isListLoading {
			FeatureBrowserPlaceholder(
				systemImage: DetailRoute.library.systemImage,
				title: "No library items",
				prompt: "Add a file",
				onCreate: { store.isImporterPresented = true },
				createPhrase: "add one",
				createAccessibilityIdentifier: "library-empty-add-button"
			)
		} else {
			FeatureBrowserList(
				isLoading: store.isListLoading,
				isEmpty: store.items.isEmpty,
				loadingText: "Loading library…",
				emptyText: "No library items",
				onClearSelection: { store.clearSelection() }
			) {
				ForEach(Array(store.items.enumerated()), id: \.element.id) { index, item in
					VStack(spacing: 0) {
						libraryRow(item)
						if index < store.items.count - 1 {
							Divider()
								.overlay(AppTheme.separator)
								.opacity(0.5)
								.padding(.leading, FeatureBrowserMetrics.glyphSize + FeatureBrowserMetrics.rowContentSpacing)
						}
					}
				}
			}
		}
	}

	private func libraryRow(_ item: LibraryAsset) -> some View {
		Button {
			handleRowClick(item)
		} label: {
			FeatureBrowserRow(
				title: item.title,
				subtitle: item.description.isEmpty ? item.originalFilename : item.description,
				badge: item.isPending ? "Indexing" : (item.isFailed ? "Failed" : nil),
				isSelected: store.selectedItemIds.contains(item.id),
				accessibilityIdentifier: "library-row-\(item.id)",
				leading: {
					FeatureBrowserRowGlyph(systemImage: item.systemImage, isSelected: store.selectedItemIds.contains(item.id))
						.intelligenceOutline(isActive: item.isPending, in: Circle())
				},
				trailing: {
					Text(item.byteSizeLabel)
						.font(.system(size: 11, weight: .medium))
						.foregroundStyle(AppTheme.tertiaryText)
						.monospacedDigit()
				}
			)
		}
		.buttonStyle(.plain)
		.contextMenu {
			Button("Quick Look", systemImage: "eye") {
				store.selectItem(id: item.id)
				onQuickLook(item)
			}
			Button("Reveal in Finder", systemImage: "folder") {
				RevealInFinder.reveal(path: item.absolutePath)
			}
			Button("Delete", systemImage: "trash", role: .destructive) {
				store.requestDelete(item)
			}
			.disabled(store.isSaving)
		}
	}

	private func handleRowClick(_ item: LibraryAsset) {
		if NSEvent.modifierFlags.contains(.command) {
			var ids = store.selectedItemIds
			if ids.contains(item.id) {
				ids.remove(item.id)
			} else {
				ids.insert(item.id)
			}
			store.selectItems(ids: ids)
		} else {
			store.selectItem(id: item.id)
		}
	}
}
