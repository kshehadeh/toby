import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("SchedulesView")
struct SchedulesViewTests {
	@Test("schedules view uses navigation split view with sidebar")
	func schedulesViewUsesNavigationSplitView() throws {
		let view = SchedulesView(store: SchedulesStore())
		let splitView = try view.inspect().navigationSplitView()
		#expect(throws: Never.self) { try splitView.sidebarView() }
		#expect(throws: Never.self) { try splitView.detailView() }
	}
}
