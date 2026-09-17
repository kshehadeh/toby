import SwiftUI

/// Settings catalog of installable plugins. Selecting a row pushes the plugin
/// Form via `NavigationStack` while the sidebar stays on Integrations.
struct IntegrationsSettingsView: View {
	@Bindable var store: ConfigureStore
	@Binding var path: [String]
	@State private var mcpDraft: McpConnectionDraft?

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
			onAdd: { mcpDraft = McpConnectionDraft() },
			addTitle: "Add MCP server"
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
