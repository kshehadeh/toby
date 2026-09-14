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
			prompt: "Select a project",
			onCreate: { created = true },
			createAccessibilityIdentifier: "empty-create-project-button"
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "feature-browser-placeholder")
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
			prompt: "Select an integration"
		)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Select an integration from the list.")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "feature-browser-placeholder-create")
		}
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
