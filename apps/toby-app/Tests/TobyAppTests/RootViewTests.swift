import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("RootView")
struct RootViewTests {
	@Test("visibility extension prevents detail-only collapse")
	func visibilityPreventsDetailOnly() {
		#expect(NavigationSplitViewVisibility.all.sidebarVisible == .all)
		#expect(NavigationSplitViewVisibility.detailOnly.sidebarVisible == .all)
		#expect(NavigationSplitViewVisibility.doubleColumn.sidebarVisible == .doubleColumn)
	}

	private func makeRootView() -> RootView {
		RootView(
			store: ChatStore(),
			configureStore: ConfigureStore(),
			recordingsStore: RecordingsStore(),
			schedulesStore: SchedulesStore(),
			integrationsStore: ConfigureStore()
		)
	}

	@Test("root view presents app sidebar")
	func rootViewPresentsAppSidebar() throws {
		let view = makeRootView()
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "app-sidebar")
		}
	}

	@Test("sidebar visibility onChange can be called")
	func sidebarVisibilityOnChangeCallable() throws {
		let view = makeRootView()
		let navSplitView = try view.inspect().navigationSplitView()
		try navSplitView.callOnChange(
			oldValue: NavigationSplitViewVisibility.all,
			newValue: NavigationSplitViewVisibility.detailOnly
		)
		// After the handler, the view should still expose the sidebar
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "app-sidebar")
		}
	}
}
