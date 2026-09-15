import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("IntegrationsSettings")
struct IntegrationsSettingsTests {
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

	@Test("integrations section has correct key and label")
	func integrationsSectionProperties() {
		let section = SettingsItem.integrationsSection
		#expect(section.key == SettingsItem.integrationsSectionKey)
		#expect(section.label == "Integrations")
		#expect(section.navKey == SettingsItem.integrationsSectionKey)
		#expect(SettingsSidebarIcon.systemName(for: section) == "puzzlepiece.extension")
	}

	@Test("integrations tab is a client-only settings tab")
	func integrationsIsClientOnlyTab() {
		#expect(
			RootSettingsNavigation.clientOnlySettingsTabKeys.contains(
				SettingsItem.integrationsSectionKey
			)
		)
	}

	@Test("integration sections are derived from settings sections")
	func integrationSectionsFromSettingsSections() {
		let store = ConfigureStore()
		store.settingsSections = [makeTree().children![0]]
		#expect(store.integrationSections.count == 2)
		#expect(store.integrationSections.map(\.label).sorted() == ["Gmail", "Todoist"])
		#expect(store.isIntegrationPluginKey("gmail"))
		#expect(!store.isIntegrationPluginKey("integrations"))
	}

	@Test("integration sections fall back to the configure tree")
	func integrationSectionsFromTree() {
		let store = ConfigureStore()
		store.tree = makeTree()
		#expect(store.integrationSections.count == 2)
		#expect(store.integrationSections.map(\.label).sorted() == ["Gmail", "Todoist"])
	}

	@Test("catalog lists plugins without auto-selecting one")
	func catalogListsPluginsWithoutSelection() throws {
		let store = ConfigureStore()
		store.settingsSections = [makeTree().children![0]]
		#expect(store.selectedNavKey == nil)
		var path: [String] = []
		let view = IntegrationsSettingsView(store: store, path: Binding(
			get: { path },
			set: { path = $0 }
		))
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-integrations-catalog")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Todoist")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-integration-row-gmail")
		}
		#expect(path.isEmpty)
	}

	@Test("select integration home clears the selected section")
	func selectIntegrationHomeClearsSelection() {
		let store = ConfigureStore()
		store.selectedNavKey = "gmail"
		store.selectIntegrationHome()
		#expect(store.selectedNavKey == nil)
	}

	@Test("settings window includes Integrations in the sidebar")
	func settingsWindowShowsIntegrationsSidebarRow() throws {
		let store = ConfigureStore()
		let view = SettingsWindowView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-sidebar-integrations")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Integrations")
		}
	}

	@Test("integration settings row renders image icon URL")
	func integrationSettingsRowRendersImageIconUrl() throws {
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
		let view = IntegrationsSettingsRow(section: section, status: nil, isStatusLoading: false)
		#expect(throws: Never.self) { try view.inspect().find(SidebarIconView.self) }
	}

	@Test("integration settings row shows connected status")
	func integrationSettingsRowShowsConnectedStatus() throws {
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
		let view = IntegrationsSettingsRow(section: section, status: status, isStatusLoading: false)
		#expect(throws: Never.self) { try view.inspect().find(text: "Connected") }
	}

	@Test("integration header shows connect when not connected")
	func integrationHeaderShowsConnect() throws {
		let store = ConfigureStore()
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
		let view = IntegrationDetailHeader(
			store: store,
			section: section,
			status: status,
			isLoading: false,
			isActionLoading: false,
			onAction: { _ in }
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Connect") }
	}

	@Test("integration meta sections show plugin path")
	func integrationMetaSectionsShowPluginPath() throws {
		let status = IntegrationStatus(
			name: "gmail", displayName: "Gmail", description: nil,
			connected: true, pluginPath: "/Users/toby/plugins/gmail", supportsSetup: false,
			setupDescription: nil, health: nil, authMethods: nil
		)
		let view = IntegrationSettingsMetaSections(status: status)
		#expect(throws: Never.self) { try view.inspect().find(RevealPathButton.self) }
	}

	@Test("plugin nav key seeds settings selection for a deep link")
	func pluginNavKeySeedsDeepLink() {
		let store = ConfigureStore()
		store.settingsSections = [makeTree().children![0]]
		RootSettingsNavigation.prepare(configureStore: store, navKey: "gmail")
		#expect(store.selectedNavKey == "gmail")
		#expect(store.isIntegrationPluginKey("gmail"))
	}

	@Test("catalog nav key stays on the integrations client tab")
	func catalogNavKeyStaysOnClientTab() {
		let store = ConfigureStore()
		RootSettingsNavigation.prepare(
			configureStore: store,
			navKey: SettingsItem.integrationsSectionKey
		)
		#expect(store.selectedNavKey == SettingsItem.integrationsSectionKey)
		#expect(
			RootSettingsNavigation.clientOnlySettingsTabKeys.contains(
				SettingsItem.integrationsSectionKey
			)
		)
	}

	@Test("plugin form detail shows connect and credential fields")
	func pluginFormShowsConnectAndCredentials() throws {
		let store = ConfigureStore()
		store.integrationLabels["gmail"] = "Gmail"
		store.integrationStatus["gmail"] = IntegrationStatus(
			name: "gmail", displayName: "Gmail", description: nil,
			connected: false, pluginPath: nil, supportsSetup: false,
			setupDescription: nil, health: nil, authMethods: nil
		)
		let section = SettingsItem(
			label: "Gmail",
			kind: .section,
			key: "gmail",
			navKey: "gmail",
			children: [
				SettingsItem(
					label: "App Password",
					kind: .value,
					key: "gmail.appPassword",
					navKey: "gmail.appPassword",
					children: nil,
					masked: true,
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
		let view = ConfigureSectionDetailView(store: store, section: section)
		#expect(throws: Never.self) { try view.inspect().find(text: "Connect") }
		#expect(throws: Never.self) { try view.inspect().find(text: "App Password") }
	}

	@Test("integration tools appear as a form section")
	func integrationToolsAppearAsFormSection() throws {
		let store = ConfigureStore()
		let section = SettingsItem(
			label: "Gmail", kind: .section, key: "gmail", navKey: "gmail", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		store.integrationStatus["gmail"] = IntegrationStatus(
			name: "gmail", displayName: "Gmail", description: nil,
			connected: true, pluginPath: nil, supportsSetup: false,
			setupDescription: nil, health: nil, authMethods: nil,
			tools: [
				IntegrationToolDefinition(
					name: "gmailSearch",
					displayName: "Search Mail",
					description: "Find messages in the connected Gmail mailbox.",
					readOnly: true,
					standardTool: nil,
					inputSchema: nil
				),
			]
		)
		let view = IntegrationSettingsToolsAndGuideSections(store: store, section: section)
		#expect(throws: Never.self) { try view.inspect().find(text: "Tools (1)") }
	}
}
