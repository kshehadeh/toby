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

	@Test("unselected integrations show cards")
	func unselectedIntegrationsShowCards() throws {
		let store = ConfigureStore()
		store.tree = makeTree()
		let view = IntegrationsDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "integrations-home-view")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "integration-card-gmail")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Todoist")
		}
	}

	@Test("integrations sidebar offers the all-integrations view")
	func integrationsSidebarOffersHomeView() throws {
		let store = ConfigureStore()
		store.tree = makeTree()
		let view = IntegrationsSidebarView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "integrations-home-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Integrations")
		}
	}

	@Test("select integration home clears the selected section")
	func selectIntegrationHomeClearsSelection() {
		let store = ConfigureStore()
		store.selectedNavKey = "gmail"
		store.selectIntegrationHome()
		#expect(store.selectedNavKey == nil)
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

	@Test("integration detail content renders two-column structure")
	func integrationDetailContentRendersTwoColumnStructure() throws {
		let store = ConfigureStore()
		store.tree = makeTree()
		store.selectedNavKey = "gmail"
		let section = try #require(store.selectedSection)
		let view = IntegrationDetailContent(store: store, section: section)
		#expect(throws: Never.self) { try view.inspect().find(IntegrationDetailHeaderView.self) }
		#expect(throws: Never.self) { try view.inspect().find(IntegrationInspectorSidebar.self) }
	}

	@Test("integration detail expands supported tools")
	func integrationDetailExpandsSupportedTools() throws {
		let view = IntegrationToolsSection(
			tools: [
				IntegrationToolDefinition(
					name: "gmailSearch",
					displayName: "Search Mail",
					description: "Find messages in the connected Gmail mailbox.",
					readOnly: true,
					standardTool: nil,
					inputSchema: nil
				),
			],
			isExpanded: .constant(true)
		)

		let inspected = try view.inspect()
		#expect(throws: Never.self) { try inspected.find(text: "Tools") }
		#expect(throws: Never.self) { try inspected.find(text: "Search Mail") }
		#expect(throws: Never.self) {
			try inspected.find(text: "Find messages in the connected Gmail mailbox.")
		}
	}

	@Test("integration header shows connected status pill")
	func integrationHeaderShowsConnectedStatusPill() throws {
		let section = SettingsItem(
			label: "Gmail", kind: .section, key: "gmail", navKey: "gmail", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		let status = IntegrationStatus(
			name: "gmail", displayName: "Gmail", description: nil,
			connected: true, pluginPath: nil, supportsSetup: false,
			setupDescription: nil, health: nil, authMethods: nil
		)
		let view = IntegrationDetailHeaderView(section: section, status: status, isLoading: false)
		#expect(throws: Never.self) { try view.inspect().find(text: "Connected") }
	}

	@Test("integration header shows not connected status pill")
	func integrationHeaderShowsNotConnectedStatusPill() throws {
		let section = SettingsItem(
			label: "Gmail", kind: .section, key: "gmail", navKey: "gmail", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		let view = IntegrationDetailHeaderView(section: section, status: nil, isLoading: false)
		#expect(throws: Never.self) { try view.inspect().find(text: "Not connected") }
	}

	@Test("integration sidebar shows connect button when not connected")
	func integrationSidebarShowsConnectButton() throws {
		let store = ConfigureStore()
		store.tree = makeTree()
		let section = SettingsItem(
			label: "Gmail", kind: .section, key: "gmail", navKey: "gmail", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		let status = IntegrationStatus(
			name: "gmail", displayName: "Gmail", description: nil,
			connected: false, pluginPath: "/path/to/plugin", supportsSetup: false,
			setupDescription: nil, health: nil, authMethods: nil
		)
		let view = IntegrationInspectorSidebar(
			store: store, section: section, status: status,
			isActionLoading: false, onAction: { _ in }
		)
		#expect(throws: Never.self) { try view.inspect().find(button: "Connect") }
	}

	@Test("integration sidebar shows disconnect and reconnect when connected")
	func integrationSidebarShowsDisconnectAndReconnect() throws {
		let store = ConfigureStore()
		store.tree = makeTree()
		let section = SettingsItem(
			label: "Gmail", kind: .section, key: "gmail", navKey: "gmail", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		let status = IntegrationStatus(
			name: "gmail", displayName: "Gmail", description: "Gmail integration",
			connected: true, pluginPath: "/path/to/plugin", supportsSetup: true,
			setupDescription: nil, health: IntegrationHealth(ok: true, details: nil, tools: nil),
			authMethods: [IntegrationAuthMethod(id: "oauth", label: "OAuth", isDefault: true)]
		)
		let view = IntegrationInspectorSidebar(
			store: store, section: section, status: status,
			isActionLoading: false, onAction: { _ in }
		)
		#expect(throws: Never.self) { try view.inspect().find(button: "Disconnect") }
		#expect(throws: Never.self) { try view.inspect().find(button: "Re-authorize") }
	}

	@Test("integration sidebar shows plugin path reveal button in location section")
	func integrationSidebarShowsPluginPath() throws {
		let store = ConfigureStore()
		store.tree = makeTree()
		let section = SettingsItem(
			label: "Gmail", kind: .section, key: "gmail", navKey: "gmail", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		let status = IntegrationStatus(
			name: "gmail", displayName: "Gmail", description: nil,
			connected: true, pluginPath: "/Users/toby/plugins/gmail", supportsSetup: false,
			setupDescription: nil, health: nil, authMethods: nil
		)
		let view = IntegrationInspectorSidebar(
			store: store, section: section, status: status,
			isActionLoading: false, onAction: { _ in }
		)
		#expect(throws: Never.self) { try view.inspect().find(RevealPathButton.self) }
	}
}
