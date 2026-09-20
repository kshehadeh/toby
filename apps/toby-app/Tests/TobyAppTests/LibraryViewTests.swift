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
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "library-empty-add-button")
		}
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
}

private func sampleLibraryItem(
	id: String = "lib-1",
	title: String = "Quarterly plan"
) -> LibraryAsset {
	LibraryAsset(
		id: id,
		title: title,
		originalFilename: "quarterly-plan.md",
		relativePath: "\(id)/quarterly-plan.md",
		mimeType: "text/markdown",
		byteSize: 128,
		contentHash: "abc123",
		description: "Ship the library feature this week.",
		status: "ready",
		source: "ui",
		createdAt: "2026-09-20T12:00:00Z",
		updatedAt: "2026-09-20T12:00:00Z"
	)
}
