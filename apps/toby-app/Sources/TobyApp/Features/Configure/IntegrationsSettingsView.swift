import SwiftUI

/// Settings catalog of installable plugins. Selecting a row pushes the plugin
/// Form via `NavigationStack` while the sidebar stays on Integrations.
struct IntegrationsSettingsView: View {
	@Bindable var store: ConfigureStore
	@Binding var path: [String]

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
			emptyDescription: "Install a plugin to connect a service Toby can use in chat.",
			statusText: { section in
				if store.integrationStatusLoading == section.key { return "Checking…" }
				guard let status = store.integrationStatus[section.key] else { return "Unknown" }
				return status.connected ? "Connected" : "Not connected"
			}
		)
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
