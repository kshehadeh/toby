import SwiftUI

/// Settings catalog of AI providers. Selecting a row pushes provider detail
/// via `NavigationStack` while the sidebar stays on AI.
struct AISettingsView: View {
	@Bindable var store: ConfigureStore
	@Binding var path: [String]

	private var catalog: SettingsItem? {
		store.catalogSection(for: SettingsItem.aiSectionKey)
	}

	var body: some View {
		SettingsCatalogView(
			store: store,
			path: $path,
			title: catalog?.displayLabel ?? "AI",
			subtitle: SettingsCatalogView.subtitle(
				for: SettingsItem.aiSectionKey,
				section: catalog
			),
			systemImage: "sparkles",
			children: store.catalogChildren(for: SettingsItem.aiSectionKey),
			accessibilityCatalogId: "settings-ai-catalog",
			accessibilityRowPrefix: "settings-ai-row",
			fallbackIcon: "sparkles",
			loadingTitle: "Loading…",
			unavailableTitle: "AI unavailable",
			emptyTitle: "No providers",
			emptyDescription: "No AI providers are available.",
			statusText: { section in
				statusText(for: section)
			},
			showsConnectedCheckmark: { section in
				store.isAIProviderConfigured(sectionKey: section.key) == true
			},
			onGuidedSetupCompleted: {
				Task { await store.loadAIProviderStatuses() }
			}
		)
		.task {
			await store.loadAIProviderStatuses()
		}
	}

	private func statusText(for section: SettingsItem) -> String? {
		guard ConfigureStore.aiProviderId(fromSectionKey: section.key) != nil else {
			return nil
		}
		if store.aiProvidersStatusLoading, store.aiProviderConfigured.isEmpty {
			return "Checking…"
		}
		guard let configured = store.isAIProviderConfigured(sectionKey: section.key) else {
			return "Unknown"
		}
		return configured ? "Connected" : "Not connected"
	}
}
