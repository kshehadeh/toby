import SwiftUI

/// Settings catalog of installable plugins. Selecting a row pushes the plugin
/// Form via `NavigationStack` while the sidebar stays on Integrations.
struct IntegrationsSettingsView: View {
	@Bindable var store: ConfigureStore
	@Binding var path: [String]
	@State private var mcpDraft: McpConnectionDraft?

	private var pluginSections: [SettingsItem] {
		store.integrationSections.filter { !$0.isMcpConnection }
	}

	private var mcpSections: [SettingsItem] {
		store.integrationSections.filter(\.isMcpConnection)
	}

	var body: some View {
		SettingsCatalogView(
			store: store,
			path: $path,
			title: "Integrations",
			subtitle: SettingsCatalogView.subtitle(
				for: SettingsItem.integrationsSectionKey,
				section: SettingsItem.integrationsSection
			),
			systemImage: "puzzlepiece.extension",
			children: store.integrationSections,
			accessibilityCatalogId: "settings-integrations-catalog",
			accessibilityRowPrefix: "settings-integration-row",
			fallbackIcon: "puzzlepiece.extension",
			loadingTitle: "Loading integrations…",
			unavailableTitle: "Integrations unavailable",
			emptyTitle: "No integrations",
			emptyDescription: "Install a plugin or add an MCP server Toby can use in chat.",
			statusText: { section in
				if store.integrationStatusLoading == section.key { return "Checking…" }
				guard let status = store.integrationStatus[section.key] else { return "Unknown" }
				return status.connected ? "Connected" : "Not connected"
			},
			groups: [
				SettingsCatalogGroup(
					id: "integrations",
					title: Self.pluginSectionTitle,
					children: pluginSections,
					emptyDescription: "No plugins are available."
				),
				SettingsCatalogGroup(
					id: "mcp-servers",
					title: Self.mcpSectionTitle,
					children: mcpSections,
					addTitle: Self.addMcpTitle,
					addAccessibilityIdentifier: "settings-add-mcp-server",
					onAdd: { mcpDraft = McpConnectionDraft() }
				),
			],
			catalogTip: SettingsCatalogTip(
				id: Self.tipId,
				title: Self.tipTitle,
				message: Self.tipMessage,
				accessibilityId: "integrations-vs-mcp-tip"
			)
		)
		.sheet(item: editorSheetItem($mcpDraft, onDismiss: { mcpDraft = nil })) { _ in
			AddMcpConnectionView(store: store, draft: $mcpDraft)
		}
		.task {
			for section in store.integrationSections {
				await store.loadIntegrationStatus(for: section.key)
			}
		}
	}

	static let pluginSectionTitle = "Integrations"
	static let mcpSectionTitle = "MCP servers"
	static let addMcpTitle = "Add new MCP server"
	static let tipId = "integrations-vs-mcp"
	static let tipTitle = "Integrations and MCP servers"
	static let tipMessage =
		"Integrations are Toby plugins for a specific service, such as Slack or Apple Calendar. MCP servers are any Model Context Protocol endpoint you add yourself so Toby can use its tools in chat."
}

struct IntegrationsSettingsRow: View {
	let section: SettingsItem
	let status: IntegrationStatus?
	let isStatusLoading: Bool

	private var statusText: String {
		if isStatusLoading { return "Checking…" }
		guard let status else { return "Unknown" }
		return status.connected ? "Connected" : "Not connected"
	}

	var body: some View {
		SettingsCatalogRow(
			section: section,
			statusText: statusText,
			fallbackIcon: "puzzlepiece.extension"
		)
	}
}
