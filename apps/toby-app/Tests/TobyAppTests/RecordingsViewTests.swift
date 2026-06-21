import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("RecordingsView")
struct RecordingsViewTests {
	@Test("recordings view uses navigation split view with sidebar")
	func recordingsViewUsesNavigationSplitView() throws {
		let view = RecordingsView(store: RecordingsStore())
		let splitView = try view.inspect().navigationSplitView()
		#expect(throws: Never.self) { try splitView.sidebarView() }
		#expect(throws: Never.self) { try splitView.detailView() }
	}
}
