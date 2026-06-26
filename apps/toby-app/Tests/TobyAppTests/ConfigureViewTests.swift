import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("ConfigureView")
struct ConfigureViewTests {
	@Test("configure view renders detail content")
	func configureViewRendersDetailContent() throws {
		let store = ConfigureStore()
		let view = ConfigureView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(ConfigureDetailView.self) }
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

	@Test("personas section is excluded from settings sidebar tree")
	func personasExcludedFromSidebar() throws {
		let store = ConfigureStore()
		store.tree = SettingsItem(
			label: "Root",
			kind: .section,
			key: "root",
			navKey: nil,
			children: [
				SettingsItem(
					label: "Personas",
					kind: .section,
					key: "personas",
					navKey: nil,
					children: [],
					masked: nil,
					multiline: nil,
					options: nil,
					selectChoices: nil,
					currentValue: nil,
					selectedValues: nil,
					readOnly: nil
				),
				SettingsItem(
					label: "AI",
					kind: .section,
					key: "ai",
					navKey: nil,
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
		let sidebarTree = store.sidebarTree
		#expect(!sidebarTree.contains(where: { $0.item.key == "personas" }))
		#expect(sidebarTree.contains(where: { $0.item.key == "ai" }))
	}
}
