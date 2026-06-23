import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("ConfigureView")
struct ConfigureViewTests {
	@Test("configure view uses navigation split view with sidebar and detail")
	func configureViewUsesNavigationSplitView() throws {
		let store = ConfigureStore()
		let view = ConfigureView(store: store)
		let splitView = try view.inspect().navigationSplitView()
		#expect(throws: Never.self) { try splitView.sidebarView() }
		#expect(throws: Never.self) { try splitView.detailView() }
	}

	@Test("configure detail shows placeholder when no section selected")
	func configureDetailShowsPlaceholder() throws {
		let store = ConfigureStore()
		let view = ConfigureView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Select a section")
		}
	}

	@Test("configure detail renders selected section label")
	func configureDetailRendersSelectedSection() throws {
		let store = ConfigureStore()
		store.tree = SettingsItem(
			label: "Integrations",
			kind: .section,
			key: "integrations",
			navKey: nil,
			children: [
				SettingsItem(
					label: "Gmail",
					kind: .section,
					key: "gmail",
					navKey: "integrations.gmail",
					children: [],
					masked: nil,
					multiline: nil,
					options: nil,
					selectChoices: nil,
					currentValue: nil,
					selectedValues: nil,
					readOnly: nil
				),
			],
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil
		)
		store.selectedNavKey = "integrations.gmail"

		let view = ConfigureView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Gmail")
		}
	}
}
