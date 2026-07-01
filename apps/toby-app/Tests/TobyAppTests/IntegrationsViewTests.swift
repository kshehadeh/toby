import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("IntegrationsView")
struct IntegrationsViewTests {
	private func makeTree() -> SettingsItem {
		SettingsItem(
			label: "Root",
			kind: .section,
			key: "root",
			navKey: "root",
			children: [
				SettingsItem(
					label: "Integrations",
					kind: .section,
					key: "integrations",
					navKey: "integrations",
					children: [
						SettingsItem(
							label: "Gmail",
							kind: .section,
							key: "gmail",
							navKey: "gmail",
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
							label: "Todoist",
							kind: .section,
							key: "todoist",
							navKey: "todoist",
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
				),
				SettingsItem(
					label: "Personas",
					kind: .section,
					key: "personas",
					navKey: "personas",
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
	}

	@Test("buildSidebarTree includes all section-type nodes")
	func buildSidebarTreeIncludesAllSections() throws {
		let tree = makeTree()
		let sidebar = ConfigureTreeHelpers.buildSidebarTree(root: tree)
		let keys = sidebar.map(\.navKey)
		#expect(keys.contains("integrations"))
		#expect(keys.contains("personas"))
	}

	@Test("integration sections are derived from configure tree")
	func integrationSectionsFromTree() throws {
		let store = ConfigureStore()
		store.tree = makeTree()
		let sections = store.integrationSections
		#expect(sections.count == 2)
		#expect(sections.map(\.label).sorted() == ["Gmail", "Todoist"])
	}

	@Test("integrations view renders detail content")
	func integrationsViewRendersDetailContent() throws {
		let store = ConfigureStore()
		store.tree = makeTree()
		let view = IntegrationsView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(IntegrationsDetailView.self) }
	}

	@Test("integration sidebar row renders image icon URL")
	func integrationSidebarRowRendersImageIconUrl() throws {
		let section = SettingsItem(
			label: "Slack",
			kind: .section,
			key: "slack",
			navKey: "slack",
			children: [],
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil,
			iconUrl: "/api/plugins/slack/icon"
		)
		let view = IntegrationSidebarRow(section: section, isSelected: true)
		#expect(throws: Never.self) { try view.inspect().find(SidebarIconView.self) }
	}

	@Test("integration sidebar row renders emoji fallback")
	func integrationSidebarRowRendersEmojiFallback() throws {
		let section = SettingsItem(
			label: "Slack",
			kind: .section,
			key: "slack",
			navKey: "slack",
			children: [],
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil,
			iconUrl: nil,
			icon: "💬"
		)
		let view = IntegrationSidebarRow(section: section, isSelected: false)
		#expect(throws: Never.self) { try view.inspect().find(text: "💬") }
	}
}
