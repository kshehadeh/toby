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
}
