import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("FeatureBrowser")
struct FeatureBrowserTests {
	@Test("placeholder shows select-or-create copy")
	func placeholderShowsCreateLink() throws {
		var created = false
		let view = FeatureBrowserPlaceholder(
			systemImage: "folder",
			title: "No project selected",
			prompt: "Select a project",
			onCreate: { created = true },
			createAccessibilityIdentifier: "empty-create-project-button"
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "feature-browser-placeholder")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No project selected")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Select a project or ")
		}
		let button = try view.inspect().find(
			viewWithAccessibilityIdentifier: "empty-create-project-button"
		).button()
		try button.tap()
		#expect(created)
	}

	@Test("placeholder without create omits the link")
	func placeholderWithoutCreateOmitsLink() throws {
		let view = FeatureBrowserPlaceholder(
			systemImage: "puzzlepiece.extension",
			title: "No integration selected",
			prompt: "Select an integration"
		)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No integration selected")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Select an integration from the list.")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "feature-browser-placeholder-create")
		}
	}

	@Test("placeholder without prompt shows only the create link")
	func placeholderWithoutPromptShowsOnlyCreateLink() throws {
		var created = false
		let view = FeatureBrowserPlaceholder(
			systemImage: "books.vertical",
			title: "No library items",
			onCreate: { created = true },
			createPhrase: "Add a file now",
			createAccessibilityIdentifier: "library-empty-add-button"
		)
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: " or ")
		}
		let button = try view.inspect().find(
			viewWithAccessibilityIdentifier: "library-empty-add-button"
		).button()
		#expect(try button.labelView().text().string() == "Add a file now")
		try button.tap()
		#expect(created)
	}

	@Test("list insets content so selection does not touch the edges")
	func listInsetsContent() throws {
		#expect(FeatureBrowserMetrics.horizontalInset == 10)
		#expect(FeatureBrowserMetrics.verticalInset == 8)
		#expect(FeatureBrowserMetrics.deselectFillHeight > 0)
		#expect(FeatureBrowserMetrics.deselectFillHeight.isFinite)
		let view = FeatureBrowserList(
			isLoading: false,
			isEmpty: false,
			loadingText: "Loading",
			emptyText: "None"
		) {
			Text("Row")
		}
		let stack = try view.inspect().find(ViewType.LazyVStack.self)
		#expect(try stack.padding(.horizontal) == FeatureBrowserMetrics.horizontalInset)
		#expect(try stack.padding(.vertical) == FeatureBrowserMetrics.verticalInset)
	}

	@Test("list shows empty copy")
	func listShowsEmptyCopy() throws {
		let view = FeatureBrowserList(
			isLoading: false,
			isEmpty: true,
			loadingText: "Loading skills…",
			emptyText: "No skills"
		) {
			EmptyView()
		}
		#expect(throws: Never.self) { try view.inspect().find(text: "No skills") }
	}

	@Test("row tap does not clear selection")
	func rowTapDoesNotClearSelection() throws {
		var cleared = false
		var selected = false
		let view = FeatureBrowserList(
			isLoading: false,
			isEmpty: false,
			loadingText: "Loading",
			emptyText: "None",
			onClearSelection: { cleared = true }
		) {
			Button("Row") { selected = true }
		}
		try view.inspect().find(button: "Row").tap()
		#expect(selected)
		#expect(!cleared)
	}

	@Test("empty-area tap clears selection")
	func emptyAreaTapClearsSelection() throws {
		var cleared = false
		let view = FeatureBrowserList(
			isLoading: false,
			isEmpty: false,
			loadingText: "Loading",
			emptyText: "None",
			onClearSelection: { cleared = true }
		) {
			Text("Row")
		}
		let target = try view.inspect().find(
			viewWithAccessibilityIdentifier: "feature-browser-list-deselect"
		)
		try target.button().tap()
		#expect(cleared)
	}

	@Test("row shows title, subtitle, and selected identifier")
	func rowShowsTitleSubtitleAndIdentifier() throws {
		let view = FeatureBrowserRow(
			title: "Weekly Overview",
			subtitle: "3 chats · Toby",
			isSelected: true,
			accessibilityIdentifier: "project-sidebar-row-proj-1"
		) {
			FeatureBrowserRowGlyph(systemImage: "folder", isSelected: true)
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Weekly Overview")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "3 chats · Toby")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-sidebar-row-proj-1")
		}
	}

	@Test("row badge is visible next to the title")
	func rowShowsBadge() throws {
		let view = FeatureBrowserRow(
			title: "Email summary",
			subtitle: "Built-in flow",
			badge: "Built-in",
			isSelected: false,
			accessibilityIdentifier: "flow-sidebar-row-email"
		) {
			FeatureBrowserRowGlyph(systemImage: "envelope", isSelected: false)
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Built-in")
		}
	}

	@Test("glyph keeps a stable system image across selection")
	func glyphKeepsStableSystemImage() throws {
		let selected = FeatureBrowserRowGlyph(systemImage: "folder", isSelected: true)
		let unselected = FeatureBrowserRowGlyph(systemImage: "folder", isSelected: false)
		#expect(try selected.inspect().find(ViewType.Image.self).actualImage().name() == "folder")
		#expect(try unselected.inspect().find(ViewType.Image.self).actualImage().name() == "folder")
	}

	@Test("wide split is a peer HStack under the window toolbar, not a nested split view")
	func wideSplitUsesHStackNotNavigationSplitView() throws {
		let view = FeatureWorkspaceSplit(
			listTitle: "Skills",
			isShowingList: false,
			onShowList: {}
		) {
			Text("List")
		} detail: {
			Text("Detail")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(ViewType.HStack.self)
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(ViewType.NavigationSplitView.self)
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "feature-workspace-split")
		}
	}
}
