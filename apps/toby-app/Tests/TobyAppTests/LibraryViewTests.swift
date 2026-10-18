import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("LibraryView")
struct LibraryViewTests {
	@Test("empty library shows placeholder and empty inspector")
	func emptyLibraryShowsPlaceholder() throws {
		let store = LibraryStore()
		let view = LibraryView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No library items")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No library item selected")
		}
		let addButton = try view.inspect().find(
			viewWithAccessibilityIdentifier: "library-empty-add-button"
		).button()
		#expect(try addButton.labelView().text().string() == "Add a file now")
	}

	@Test("unselected items show the empty inspector")
	func unselectedItemsShowEmptyInspector() throws {
		let store = LibraryStore()
		store.items = [sampleLibraryItem()]
		let view = LibraryView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Quarterly plan")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "library-inspector-bar")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No library item selected")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Select a file to view its details")
		}
	}

	@Test("selected item shows inspector details")
	func selectedItemShowsInspector() throws {
		let store = LibraryStore()
		store.items = [sampleLibraryItem()]
		store.selectItem(id: "lib-1")
		let view = LibraryView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "library-inspector-title")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Ship the library feature this week.")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "delete-library-item-button")
		}
	}

	@Test("selected item shows where the file came from")
	func selectedItemShowsOrigins() throws {
		let store = LibraryStore()
		store.items = [
			sampleLibraryItem(
				references: [
					LibraryReference(
						id: "ref-chat",
						kind: "chat",
						label: "Weekly planning",
						detail: "quarterly-plan.md",
						sessionId: "session-1",
						projectId: nil,
						createdAt: "2026-09-20T12:00:00Z"
					)
				]
			)
		]
		store.selectItem(id: "lib-1")
		let view = LibraryInspectorBar(store: store, onQuickLook: {}, onReveal: {})
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Where it came from")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Weekly planning")
		}
		#expect(store.items[0].originSummary == "Chat")
	}

	@Test("delete confirmation is staged from the inspector")
	func deleteConfirmationIsStaged() {
		let store = LibraryStore()
		store.requestDelete(sampleLibraryItem())
		#expect(store.pendingDelete?.ids == ["lib-1"])
		#expect(store.pendingDelete?.title == "Quarterly plan")
	}

	@Test("multi-select inspector offers batch delete")
	func multiSelectInspectorOffersBatchDelete() throws {
		let store = LibraryStore()
		store.items = [
			sampleLibraryItem(),
			sampleLibraryItem(id: "lib-2", title: "Screenshot"),
		]
		store.selectItems(ids: ["lib-1", "lib-2"])
		let view = LibraryInspectorBar(store: store, onQuickLook: {}, onReveal: {})
		#expect(throws: Never.self) {
			try view.inspect().find(text: "2 items selected")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "delete-library-items-button")
		}
	}

	@Test("clearSelection drops the current item")
	func clearSelectionDropsCurrentItem() {
		let store = LibraryStore()
		store.items = [sampleLibraryItem()]
		store.selectItem(id: "lib-1")
		store.clearSelection()
		#expect(store.selectedItemIds.isEmpty)
		#expect(store.selectedItem == nil)
	}

	@Test("sidebar includes the library destination")
	func sidebarIncludesLibrary() {
		#expect(DetailRoute.allCases.contains(.library))
		#expect(DetailRoute.library.rawValue == "library")
		#expect(DetailRoute.library.menuTitle == "Library")
		#expect(DetailRoute.library.systemImage == "books.vertical")
		#expect(DetailRoute.sidebarPrimary.contains(.library))
	}

	@Test("list layout keeps a row for each file")
	func listLayoutKeepsRows() throws {
		let store = LibraryStore(defaults: isolatedDefaults())
		store.items = [sampleLibraryItem()]
		store.layout = .list
		let view = LibraryView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "library-row-lib-1")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(LibraryItemArtwork.self)
		}
		#expect(LibraryIconMetrics.listThumbnailSide < LibraryIconMetrics.iconSide)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "library-icon-grid")
		}
	}

	@Test("icon layout shows the file name under its icon")
	func iconLayoutShowsNameUnderIcon() throws {
		let store = LibraryStore(defaults: isolatedDefaults())
		store.items = [
			sampleLibraryItem(),
			sampleLibraryItem(id: "lib-2", title: "Screenshot", status: "pending"),
		]
		store.layout = .icons
		let view = LibraryView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "library-icon-grid")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "library-icon-lib-1")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Quarterly plan")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Indexing")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "library-row-lib-1")
		}
	}

	@Test("layout picker is the list and icon switch")
	func layoutPickerIsTheViewSwitch() throws {
		let view = LibraryLayoutPicker(selection: .constant(.list))
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "library-layout-picker")
		}
		#expect(LibraryLayout.list.systemImage == "list.bullet")
		#expect(LibraryLayout.icons.systemImage == "square.grid.2x2")
		#expect(LibraryLayout.icons.help == "Icon view")
	}

	@Test("layout preference is remembered")
	func layoutPreferenceIsRemembered() {
		let name = "toby.tests.library.layout.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: name)!
		defer { defaults.removePersistentDomain(forName: name) }
		let store = LibraryStore(defaults: defaults)
		#expect(store.layout == .list)
		store.setLayout(.icons)
		#expect(store.layout == .icons)
		let restored = LibraryStore(defaults: defaults)
		#expect(restored.layout == .icons)
		restored.setLayout(.icons)
		#expect(defaults.string(forKey: LibraryStore.layoutDefaultsKey) == "icons")
	}

	@Test("double-click monitor ignores clicks outside its file and keeps the first click")
	func doubleClickMonitorFiltersClicks() throws {
		let view = LibraryItemDoubleClickView(frame: NSRect(x: 0, y: 0, width: 100, height: 40))
		let parent = NSView(frame: NSRect(x: 0, y: 0, width: 200, height: 100))
		parent.addSubview(view)

		let recognizer = try #require(
			parent.gestureRecognizers.compactMap { $0 as? NSClickGestureRecognizer }.first
		)
		#expect(recognizer.numberOfClicksRequired == 2)
		#expect(recognizer.delaysPrimaryMouseButtonEvents == false)
		#expect(view.hitTest(NSPoint(x: 10, y: 10)) == nil)

		var fired = 0
		view.onDoubleClick = { fired += 1 }
		view.performDoubleClick(atLocalPoint: NSPoint(x: 10, y: 10))
		#expect(fired == 1)
		view.performDoubleClick(atLocalPoint: NSPoint(x: 180, y: 80))
		#expect(fired == 1)
	}

	@Test("a library file mounts the double-click monitor over the button")
	func doubleClickMonitorMountsOverButton() throws {
		let host = NSHostingView(
			rootView: Button("Quarterly plan") {}
				.buttonStyle(.plain)
				.libraryItemDoubleClick {}
				.frame(width: 180, height: 36)
		)
		host.frame = NSRect(x: 0, y: 0, width: 220, height: 80)
		host.layoutSubtreeIfNeeded()

		let catcher = try #require(LibraryItemDoubleClickView.instances(in: host).first)
		#expect(catcher.bounds.width > 20)
		#expect(catcher.bounds.height > 10)
		var ancestor: NSView? = catcher
		var recognizer: NSClickGestureRecognizer?
		while let view = ancestor, recognizer == nil {
			recognizer = view.gestureRecognizers.compactMap { $0 as? NSClickGestureRecognizer }.first
			ancestor = view.superview
		}
		#expect(recognizer?.numberOfClicksRequired == 2)
		#expect(recognizer?.delaysPrimaryMouseButtonEvents == false)
	}

	@Test("double-click selects that file and asks for Quick Look")
	func doubleClickAsksForQuickLook() {
		let store = LibraryStore(defaults: isolatedDefaults())
		store.items = [
			sampleLibraryItem(),
			sampleLibraryItem(id: "lib-2", title: "Screenshot"),
		]
		store.selectItem(id: "lib-2")
		var previewed: String?
		activateLibraryItem(
			sampleLibraryItem(),
			clickCount: 2,
			commandPressed: true,
			store: store
		) { previewed = $0.id }
		#expect(store.selectedItemIds == ["lib-1"])
		#expect(previewed == "lib-1")
	}

	@Test("a single click selects without asking for Quick Look")
	func singleClickDoesNotAskForQuickLook() {
		let store = LibraryStore(defaults: isolatedDefaults())
		store.items = [
			sampleLibraryItem(),
			sampleLibraryItem(id: "lib-2", title: "Screenshot"),
		]
		var previewed = false
		activateLibraryItem(
			sampleLibraryItem(id: "lib-2", title: "Screenshot"),
			clickCount: 1,
			commandPressed: true,
			store: store
		) { _ in previewed = true }
		#expect(previewed == false)
		#expect(store.selectedItemIds == ["lib-2"])
		activateLibraryItem(
			sampleLibraryItem(id: "lib-2", title: "Screenshot"),
			clickCount: 1,
			commandPressed: true,
			store: store
		) { _ in previewed = true }
		#expect(previewed == false)
		#expect(store.selectedItemIds.isEmpty)
	}

	@Test("command-click toggles a file in the selection")
	func commandClickTogglesSelection() {
		let store = LibraryStore(defaults: isolatedDefaults())
		store.items = [
			sampleLibraryItem(),
			sampleLibraryItem(id: "lib-2", title: "Screenshot"),
		]
		store.selectFromPointerClick(id: "lib-1", extending: false)
		store.selectFromPointerClick(id: "lib-2", extending: true)
		#expect(store.selectedItemIds == ["lib-1", "lib-2"])
		store.selectFromPointerClick(id: "lib-1", extending: true)
		#expect(store.selectedItemIds == ["lib-2"])
	}

	@Test("image files use a thumbnail and missing files do not")
	func imageThumbnailAndMissingFile() async throws {
		LibraryItemArtworkLoader.resetCacheForTesting()
		let directory = FileManager.default.temporaryDirectory
			.appendingPathComponent("toby-library-icon-\(UUID().uuidString)", isDirectory: true)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: directory) }

		let png = directory.appendingPathComponent("pixel.png")
		let bytes = try #require(
			Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
		)
		try bytes.write(to: png)
		#expect(ImageDownsampling.downsample(url: png, maxPixelSize: 32) != nil)

		let thumbnail = await LibraryItemArtworkLoader.load(
			path: png.path,
			mimeType: "image/png",
			pointSize: 72
		)
		#expect(thumbnail != nil)

		let icon = await LibraryItemArtworkLoader.load(
			path: directory.appendingPathComponent("gone.md").path,
			mimeType: "text/markdown",
			pointSize: 72
		)
		#expect(icon == nil)
	}
}

private func isolatedDefaults() -> UserDefaults {
	let name = "toby.tests.library.\(UUID().uuidString)"
	let defaults = UserDefaults(suiteName: name)!
	defaults.removePersistentDomain(forName: name)
	return defaults
}

private func sampleLibraryItem(
	id: String = "lib-1",
	title: String = "Quarterly plan",
	relativePath: String? = nil,
	mimeType: String = "text/markdown",
	status: String = "ready",
	references: [LibraryReference]? = nil
) -> LibraryAsset {
	LibraryAsset(
		id: id,
		title: title,
		originalFilename: "quarterly-plan.md",
		relativePath: relativePath ?? "\(id)/quarterly-plan.md",
		mimeType: mimeType,
		byteSize: 128,
		contentHash: "abc123",
		description: "Ship the library feature this week.",
		status: status,
		source: "ui",
		createdAt: "2026-09-20T12:00:00Z",
		updatedAt: "2026-09-20T12:00:00Z",
		references: references
	)
}
