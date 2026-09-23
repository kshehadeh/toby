import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("IntegrationsSettings")
struct IntegrationsSettingsTests {
	private func sectionItem(label: String, key: String) -> SettingsItem {
		SettingsItem(
			label: label,
			kind: .section,
			key: key,
			navKey: key,
			children: [],
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil
		)
	}

	private func makeMixedIntegrationsSection() -> SettingsItem {
		SettingsItem(
			label: "Integrations",
			kind: .section,
			key: "integrations",
			navKey: "integrations",
			children: [
				sectionItem(label: "Gmail", key: "gmail"),
				sectionItem(label: "Todoist", key: "todoist"),
				sectionItem(label: "GitHub", key: "mcp_github"),
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

	@Test("catalog groups plugins separately from MCP servers")
	func catalogGroupsPluginsAndMcpServers() throws {
		let store = ConfigureStore()
		store.settingsSections = [makeMixedIntegrationsSection()]
		var path: [String] = []
		let view = IntegrationsSettingsView(
			store: store,
			path: Binding(
				get: { path },
				set: { path = $0 }
			)
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-catalog-group-integrations")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-catalog-group-mcp-servers")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-integration-row-gmail")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-integration-row-mcp_github")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-add-mcp-server")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: IntegrationsSettingsView.addMcpTitle)
		}
		let tip = try view.inspect().find(SetupTipCard.self).actualView()
		#expect(tip.tipId == IntegrationsSettingsView.tipId)
		#expect(tip.title == IntegrationsSettingsView.tipTitle)
		#expect(tip.message == IntegrationsSettingsView.tipMessage)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "integrations-vs-mcp-tip")
		}
		#expect((try? view.inspect().find(viewWithAccessibilityIdentifier: "settings-catalog-add")) == nil)
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

	@Test("disconnected integration omits the health banner")
	func disconnectedIntegrationOmitsHealthBanner() throws {
		let store = ConfigureStore()
		let section = SettingsItem(
			label: "Apple Calendar", kind: .section, key: "applecalendar", navKey: "applecalendar",
			children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		let status = IntegrationStatus(
			name: "applecalendar", displayName: "Apple Calendar", description: nil,
			connected: false, pluginPath: nil, supportsSetup: false,
			setupDescription: nil,
			health: IntegrationHealth(
				ok: false,
				details: "Apple Calendar is not connected. Run `toby connect applecalendar` on this Mac.",
				tools: nil
			),
			authMethods: nil
		)
		let view = IntegrationDetailHeader(
			store: store,
			section: section,
			status: status,
			isLoading: false,
			isActionLoading: false,
			onAction: { _ in }
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Not connected") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Connect") }
		#expect(
			(try? view.inspect().find(
				text: "Apple Calendar is not connected. Run `toby connect applecalendar` on this Mac."
			)) == nil
		)
	}

	@Test("connected integration still shows an unhealthy health banner")
	func connectedIntegrationShowsUnhealthyBanner() throws {
		let store = ConfigureStore()
		let section = SettingsItem(
			label: "Apple Calendar", kind: .section, key: "applecalendar", navKey: "applecalendar",
			children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		let status = IntegrationStatus(
			name: "applecalendar", displayName: "Apple Calendar", description: nil,
			connected: true, pluginPath: nil, supportsSetup: false,
			setupDescription: nil,
			health: IntegrationHealth(
				ok: false,
				details: "Calendar permission was denied.",
				tools: nil
			),
			authMethods: nil
		)
		let view = IntegrationDetailHeader(
			store: store,
			section: section,
			status: status,
			isLoading: false,
			isActionLoading: false,
			onAction: { _ in }
		)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Calendar permission was denied.")
		}
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

	@Test("integration header reveals the plugin folder")
	func integrationHeaderRevealsPluginFolder() throws {
		let store = ConfigureStore()
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
		let view = IntegrationDetailHeader(
			store: store,
			section: section,
			status: status,
			isLoading: false,
			isActionLoading: false,
			onAction: { _ in }
		)
		let button = try view.inspect().find(button: "Plugin: /Users/toby/plugins/gmail")
		#expect(try button.accessibilityLabel().string() == "Show plugin folder in Finder")
	}

	@Test("integration meta sections omit the plugin location section")
	func integrationMetaSectionsOmitPluginLocation() throws {
		let status = IntegrationStatus(
			name: "gmail", displayName: "Gmail", description: nil,
			connected: true, pluginPath: "/Users/toby/plugins/gmail", supportsSetup: false,
			setupDescription: nil, health: nil, authMethods: nil
		)
		let view = IntegrationSettingsMetaSections(status: status)
		#expect((try? view.inspect().find(text: "Location")) == nil)
		#expect((try? view.inspect().find(RevealPathButton.self)) == nil)
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
		let stack = try view.inspect().find(ViewType.VStack.self)
		#expect(try stack.alignment() == .leading)
	}

	@Test("setup guide steps stay out of the integration form")
	func setupGuideStepsStayOutOfTheForm() throws {
		let store = ConfigureStore()
		let section = SettingsItem(
			label: "Gmail", kind: .section, key: "gmail", navKey: "gmail", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		store.setupGuide = IntegrationSetupGuide(
			ok: true,
			name: "gmail",
			displayName: "Gmail",
			description: nil,
			steps: [
				IntegrationSetupGuideStep(
					id: "overview",
					title: "What Gmail can do",
					description: "Read and organize email.",
					links: nil,
					artifacts: nil
				),
			],
			error: nil
		)
		store.setupGuideLoading = "gmail"
		let view = IntegrationSettingsToolsAndGuideSections(store: store, section: section)
		#expect((try? view.inspect().find(text: "Setup Guide")) == nil)
		#expect((try? view.inspect().find(text: "What Gmail can do")) == nil)
		#expect((try? view.inspect().find(text: "Loading setup guide…")) == nil)
	}

	@Test("empty integrations catalog still shows MCP add and the grouping tip")
	func emptyIntegrationsCatalogShowsMcpAddAndTip() throws {
		let store = ConfigureStore()
		var path: [String] = []
		let view = IntegrationsSettingsView(
			store: store,
			path: Binding(
				get: { path },
				set: { path = $0 }
			)
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-integrations-catalog")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-catalog-group-integrations")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No plugins are available.")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-catalog-group-mcp-servers")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-add-mcp-server")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: IntegrationsSettingsView.addMcpTitle)
		}
		let tip = try view.inspect().find(SetupTipCard.self).actualView()
		#expect(tip.title == IntegrationsSettingsView.tipTitle)
		#expect((try? view.inspect().find(text: "No integrations")) == nil)
	}

	@Test("MCP draft encodes a create request")
	func mcpDraftEncodesCreateRequest() {
		var draft = McpConnectionDraft(displayName: " GitHub ", transport: "http")
		draft.url = "https://example.com/mcp"
		draft.authMethod = "headers"
		draft.bearerToken = "tok"
		let request = draft.toRequest()
		#expect(request.displayName == "GitHub")
		#expect(request.transport == "http")
		#expect(request.url == "https://example.com/mcp")
		#expect(request.bearerToken == "tok")
		#expect(request.connect == true)
	}

	@Test("MCP connection keys are detected")
	func mcpConnectionKeysAreDetected() {
		let mcp = SettingsItem(
			label: "GitHub", kind: .section, key: "mcp_github", navKey: "mcp_github", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		let slack = SettingsItem(
			label: "Slack", kind: .section, key: "slack", navKey: "slack", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		#expect(mcp.isMcpConnection)
		#expect(!slack.isMcpConnection)
	}

	@Test("MCP draft requires command or URL")
	func mcpDraftValidation() {
		var draft = McpConnectionDraft(displayName: "GitHub", transport: "http")
		#expect(!draft.canSave)
		draft.url = "https://example.com/mcp"
		#expect(draft.canSave)
		draft.transport = "stdio"
		#expect(!draft.canSave)
		draft.command = "npx"
		#expect(draft.canSave)
	}

	@Test("MCP header shows remove even before status loads")
	func mcpHeaderShowsRemoveWithoutStatus() throws {
		let store = ConfigureStore()
		let section = SettingsItem(
			label: "Jira", kind: .section, key: "mcp_jira", navKey: "mcp_jira", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		let view = IntegrationDetailHeader(
			store: store,
			section: section,
			status: nil,
			isLoading: true,
			isActionLoading: true,
			onAction: { _ in },
			onRemove: {}
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Remove") }
	}

	@Test("MCP remove is available when status never loaded")
	func mcpRemoveWithoutStatus() throws {
		let store = ConfigureStore()
		store.integrationLabels["mcp_jira"] = "Jira"
		let section = SettingsItem(
			label: "Jira", kind: .section, key: "mcp_jira", navKey: "mcp_jira", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		let view = ConfigureSectionDetailView(store: store, section: section)
		try view.inspect().find(button: "Remove").tap()
		#expect(store.pendingDelete?.action == "remove-connection")
		#expect(store.pendingDelete?.body["id"] == "mcp_jira")
	}

	@Test("MCP header shows remove")
	func mcpHeaderShowsRemove() throws {
		let store = ConfigureStore()
		let section = SettingsItem(
			label: "GitHub", kind: .section, key: "mcp_github", navKey: "mcp_github", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		let status = IntegrationStatus(
			name: "mcp_github", displayName: "GitHub", description: nil,
			connected: true, pluginPath: nil, supportsSetup: false,
			setupDescription: nil, health: nil, authMethods: nil
		)
		let view = IntegrationDetailHeader(
			store: store,
			section: section,
			status: status,
			isLoading: false,
			isActionLoading: false,
			onAction: { _ in },
			onRemove: {}
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Remove") }
	}

	@Test("MCP remove stages a remove-connection confirmation")
	func mcpRemoveStagesPendingDelete() throws {
		let store = ConfigureStore()
		store.integrationLabels["mcp_github"] = "GitHub"
		let section = SettingsItem(
			label: "GitHub", kind: .section, key: "mcp_github", navKey: "mcp_github", children: [],
			masked: nil, multiline: nil, options: nil, selectChoices: nil,
			currentValue: nil, selectedValues: nil, readOnly: nil
		)
		store.integrationStatus["mcp_github"] = IntegrationStatus(
			name: "mcp_github", displayName: "GitHub", description: nil,
			connected: true, pluginPath: nil, supportsSetup: false,
			setupDescription: nil, health: nil, authMethods: nil
		)
		let view = ConfigureSectionDetailView(store: store, section: section)
		try view.inspect().find(button: "Remove").tap()
		#expect(store.pendingDelete?.action == "remove-connection")
		#expect(store.pendingDelete?.body["id"] == "mcp_github")
		#expect(store.pendingDelete?.confirmLabel == "Remove")
	}

	@Test("settings window presents the captured MCP remove confirmation")
	func settingsWindowPresentsMcpRemoveConfirmation() throws {
		let store = ConfigureStore()
		store.pendingDelete = ConfigureStore.PendingDelete(
			action: "remove-connection",
			body: ["id": "mcp_github"],
			title: "Remove MCP server?",
			message: "This disconnects GitHub and deletes its saved configuration.",
			confirmLabel: "Remove"
		)
		let view = SettingsWindowView(store: store)
		let alert = try view.inspect().find(ViewType.Alert.self)
		#expect(try alert.title().string() == "Remove MCP server?")
		#expect(try alert.message().text().string().contains("GitHub"))
	}

	@Test("integration meta sections omit the duplicate status row")
	func integrationMetaSectionsOmitStatusRow() throws {
		let status = IntegrationStatus(
			name: "gmail", displayName: "Gmail", description: nil,
			connected: true, pluginPath: "/Users/toby/plugins/gmail", supportsSetup: false,
			setupDescription: nil, health: nil, authMethods: nil
		)
		let view = IntegrationSettingsMetaSections(status: status)
		#expect((try? view.inspect().find(text: "Location")) == nil)
		#expect((try? view.inspect().find(text: "Connection")) == nil)
		#expect((try? view.inspect().find(text: "Status")) == nil)
	}

	@Test("plugin form text field uses the field label instead of Enter value")
	func pluginFormTextFieldUsesFieldLabel() throws {
		let store = ConfigureStore()
		store.savedValues["gmail.displayName"] = "Test"
		let field = SettingsItem(
			label: "Display name",
			kind: .value,
			key: "gmail.displayName",
			navKey: "gmail.displayName",
			children: nil,
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: "Test",
			selectedValues: nil,
			readOnly: nil
		)
		let view = ConfigureFieldRowView(
			store: store,
			field: field,
			sectionLabel: "Gmail",
			showsDivider: false,
			usesFormChrome: true
		)
		#expect(throws: Never.self) { try view.inspect().find(ViewType.TextField.self) }
		#expect(throws: Never.self) { try view.inspect().find(text: "Display name") }
		#expect((try? view.inspect().find(text: "Enter value")) == nil)
	}

	@Test("empty integration config omits the no-options tip")
	func emptyIntegrationConfigOmitsNoOptionsTip() throws {
		let store = ConfigureStore()
		let hint = SettingsItem(
			label: "No configuration options for this integration.",
			kind: .hint,
			key: "macos._hint",
			navKey: "macos._hint",
			children: nil,
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil
		)
		let section = SettingsItem(
			label: "macOS",
			kind: .section,
			key: "macos",
			navKey: "macos",
			children: [hint],
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil
		)
		#expect(store.detailFields(for: section).isEmpty)
		let view = ConfigureSectionDetailView(store: store, section: section)
		#expect(
			(try? view.inspect().find(text: "No configuration options for this integration.")) == nil
		)
	}
}
