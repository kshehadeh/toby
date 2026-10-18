import SwiftUI
import UniformTypeIdentifiers

struct LibraryView: View {
	@Bindable var store: LibraryStore

	var body: some View {
		Group {
			if let errorMessage = store.errorMessage, store.items.isEmpty, !store.isListLoading {
				ContentUnavailableView {
					Label("Library unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else {
				LibraryCollectionView(store: store, onQuickLook: previewItem)
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
				Text("Are you sure you want to delete “\(title)” from the library? This removes Toby’s copy. The file stays in any chat or project that already has it. This cannot be undone.")
			} else {
				Text("Are you sure you want to delete \(pending.count) library items? This removes Toby’s copies. Files stay in any chat or project that already has them. This cannot be undone.")
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
		FileQuickLook.present(path: item.absolutePath)
	}

	private func revealSelected() {
		guard let item = store.inspectedItem else { return }
		RevealInFinder.reveal(path: item.absolutePath)
	}
}

struct LibraryCollectionView: View {
	@Bindable var store: LibraryStore
	var onQuickLook: (LibraryAsset) -> Void = { _ in }

	var body: some View {
		if store.items.isEmpty, !store.isListLoading {
			emptyCollection
		} else if store.layout == .icons {
			LibraryIconView(store: store, onQuickLook: onQuickLook)
		} else {
			listCollection
		}
	}

	@ViewBuilder
	private var emptyCollection: some View {
		if store.isCatalogSyncing, store.originFilter == .all, store.searchQuery.isEmpty {
			FeatureBrowserList(
				isLoading: true,
				isEmpty: true,
				loadingText: "Gathering files from chats and projects…",
				emptyText: "No library items"
			) {
				EmptyView()
			}
		} else if store.originFilter == .all, store.searchQuery.isEmpty {
			FeatureBrowserPlaceholder(
				systemImage: DetailRoute.library.systemImage,
				title: "No library items",
				onCreate: { store.isImporterPresented = true },
				createPhrase: "Add a file now",
				createAccessibilityIdentifier: "library-empty-add-button"
			)
		} else {
			FeatureBrowserPlaceholder(
				systemImage: DetailRoute.library.systemImage,
				title: store.emptyListTitle
			)
		}
	}

	private var listCollection: some View {
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
							.padding(
								.leading,
								FeatureBrowserMetrics.rowHorizontalPadding
									+ LibraryIconMetrics.listThumbnailSide
									+ FeatureBrowserMetrics.rowContentSpacing
							)
					}
				}
			}
		}
	}

	private func libraryRow(_ item: LibraryAsset) -> some View {
		Button {
			activateLibraryItem(item, store: store, onQuickLook: onQuickLook)
		} label: {
			FeatureBrowserRow(
				title: item.title,
				subtitle: item.listSubtitle,
				badge: item.isPending ? "Indexing" : (item.isFailed ? "Failed" : nil),
				isSelected: store.selectedItemIds.contains(item.id),
				accessibilityIdentifier: "library-row-\(item.id)",
				leading: {
					LibraryItemArtwork(item: item, side: LibraryIconMetrics.listThumbnailSide)
						.clipShape(
							RoundedRectangle(
								cornerRadius: LibraryIconMetrics.listThumbnailCornerRadius,
								style: .continuous
							)
						)
						.intelligenceOutline(
							isActive: item.isPending,
							in: RoundedRectangle(
								cornerRadius: LibraryIconMetrics.listThumbnailCornerRadius,
								style: .continuous
							)
						)
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
		.libraryItemDoubleClick {
			previewLibraryItem(item, store: store, onQuickLook: onQuickLook)
		}
		.accessibilityAction(named: "Quick Look") {
			previewLibraryItem(item, store: store, onQuickLook: onQuickLook)
		}
		.libraryItemMenu(item: item, store: store, onQuickLook: onQuickLook)
	}
}

/// Pointer activation for a library file.
///
/// A SwiftUI button action does not receive the second click's count, so
/// double-click Quick Look is delivered by ``libraryItemDoubleClick``.
/// `clickCount` and `commandPressed` default to the current AppKit event so
/// tests can describe a click without posting one.
@MainActor
func activateLibraryItem(
	_ item: LibraryAsset,
	clickCount: Int? = nil,
	commandPressed: Bool? = nil,
	store: LibraryStore,
	onQuickLook: (LibraryAsset) -> Void
) {
	let clicks = clickCount ?? NSApp.currentEvent?.clickCount ?? 1
	if clicks >= 2 {
		previewLibraryItem(item, store: store, onQuickLook: onQuickLook)
	} else {
		let command = commandPressed ?? NSEvent.modifierFlags.contains(.command)
		store.selectFromPointerClick(id: item.id, extending: command)
	}
}

/// Select one file and preview it. Shared by double-click, VoiceOver, and the context menu.
@MainActor
func previewLibraryItem(
	_ item: LibraryAsset,
	store: LibraryStore,
	onQuickLook: (LibraryAsset) -> Void
) {
	store.selectItem(id: item.id)
	onQuickLook(item)
}

extension View {
	/// Opens Quick Look on the second click without delaying the first click.
	///
	/// The catcher does not hit-test, so selection and the context menu stay
	/// on the row. An `NSClickGestureRecognizer` on its container reads the
	/// double-click AppKit already counted.
	func libraryItemDoubleClick(perform action: @escaping () -> Void) -> some View {
		background {
			LibraryItemDoubleClickInstaller(onDoubleClick: action)
				.accessibilityHidden(true)
		}
	}

	func libraryItemMenu(
		item: LibraryAsset,
		store: LibraryStore,
		onQuickLook: @escaping (LibraryAsset) -> Void
	) -> some View {
		contextMenu {
			Button("Quick Look", systemImage: "eye") {
				previewLibraryItem(item, store: store, onQuickLook: onQuickLook)
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
}

/// Transparent monitor for a library row. Clicks pass through to the button.
private struct LibraryItemDoubleClickInstaller: NSViewRepresentable {
	var onDoubleClick: () -> Void

	func makeNSView(context: Context) -> LibraryItemDoubleClickView {
		let view = LibraryItemDoubleClickView()
		view.onDoubleClick = onDoubleClick
		return view
	}

	func updateNSView(_ nsView: LibraryItemDoubleClickView, context: Context) {
		nsView.onDoubleClick = onDoubleClick
		nsView.installRecognizerIfNeeded()
	}

	static func dismantleNSView(_ nsView: LibraryItemDoubleClickView, coordinator: ()) {
		nsView.removeRecognizer()
	}
}

/// Installs a two-click recognizer on its container and ignores clicks outside its frame.
final class LibraryItemDoubleClickView: NSView, NSGestureRecognizerDelegate {
	var onDoubleClick: () -> Void = {}
	private var recognizer: NSClickGestureRecognizer?

	override func hitTest(_ point: NSPoint) -> NSView? { nil }

	override func viewWillMove(toSuperview newSuperview: NSView?) {
		super.viewWillMove(toSuperview: newSuperview)
		removeRecognizer()
	}

	override func viewDidMoveToSuperview() {
		super.viewDidMoveToSuperview()
		installRecognizerIfNeeded()
	}

	override func layout() {
		super.layout()
		installRecognizerIfNeeded()
	}

	func installRecognizerIfNeeded() {
		guard let host = recognizerHost() else { return }
		if let recognizer, recognizer.view === host { return }
		removeRecognizer()
		let recognizer = NSClickGestureRecognizer(target: self, action: #selector(handleDoubleClick(_:)))
		recognizer.numberOfClicksRequired = 2
		recognizer.delaysPrimaryMouseButtonEvents = false
		recognizer.delaysSecondaryMouseButtonEvents = false
		recognizer.delegate = self
		host.addGestureRecognizer(recognizer)
		self.recognizer = recognizer
	}

	/// SwiftUI hit-tests the hosting view, so the recognizer has to sit on that
	/// ancestor. A recognizer on an intermediate wrapper never sees the click.
	private func recognizerHost() -> NSView? {
		var ancestor: NSView? = superview
		var hosting: NSView?
		while let view = ancestor {
			if NSStringFromClass(type(of: view)).contains("HostingView") {
				hosting = view
				break
			}
			ancestor = view.superview
		}
		return hosting ?? superview
	}

	func removeRecognizer() {
		guard let recognizer else { return }
		recognizer.view?.removeGestureRecognizer(recognizer)
		self.recognizer = nil
	}

	@objc private func handleDoubleClick(_ recognizer: NSClickGestureRecognizer) {
		let local = convert(recognizer.location(in: nil), from: nil)
		performDoubleClick(atLocalPoint: local)
	}

	func performDoubleClick(atLocalPoint point: NSPoint) {
		guard bounds.contains(point) else { return }
		onDoubleClick()
	}

	func gestureRecognizer(
		_ gestureRecognizer: NSGestureRecognizer,
		shouldAttemptToRecognizeWith event: NSEvent
	) -> Bool {
		let local = convert(event.locationInWindow, from: nil)
		return bounds.contains(local)
	}

	func gestureRecognizer(
		_ gestureRecognizer: NSGestureRecognizer,
		shouldRecognizeSimultaneouslyWith otherGestureRecognizer: NSGestureRecognizer
	) -> Bool {
		true
	}

	static func instances(in root: NSView) -> [LibraryItemDoubleClickView] {
		var found: [LibraryItemDoubleClickView] = []
		if let match = root as? LibraryItemDoubleClickView {
			found.append(match)
		}
		for subview in root.subviews {
			found.append(contentsOf: instances(in: subview))
		}
		return found
	}
}
