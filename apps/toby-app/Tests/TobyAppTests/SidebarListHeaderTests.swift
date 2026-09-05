import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("SidebarListHeader")
struct SidebarListHeaderTests {
	@Test("renders a view title and symbol")
	func rendersTitleAndSymbol() throws {
		let view = SidebarListHeader(
			title: "Integrations",
			systemImage: "square.grid.2x2",
			isSelected: true,
		)

		#expect(throws: Never.self) {
			try view.inspect().find(text: "Integrations")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(ViewType.Image.self)
		}
	}
}
