import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("SettingsCatalog")
struct SettingsCatalogTests {
	private func makeAISection() -> SettingsItem {
		SettingsItem(
			label: "AI",
			kind: .section,
			key: SettingsItem.aiSectionKey,
			navKey: SettingsItem.aiSectionKey,
			children: [
				SettingsItem(
					label: "OpenAI",
					kind: .section,
					key: "ai.openai",
					navKey: "ai.openai",
					children: [],
					masked: nil,
					multiline: nil,
					options: nil,
					selectChoices: nil,
					currentValue: nil,
					selectedValues: nil,
					readOnly: nil,
					iconUrl: "/icons/ai/openai.png"
				),
				SettingsItem(
					label: "Vercel AI Gateway",
					kind: .section,
					key: "ai.vercel",
					navKey: "ai.vercel",
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

	@Test("AI is a catalog section with provider children")
	func aiIsCatalogSection() {
		let store = ConfigureStore()
		store.settingsSections = [makeAISection()]
		#expect(store.isCatalogSectionKey(SettingsItem.aiSectionKey))
		#expect(store.catalogChildren(for: SettingsItem.aiSectionKey).map(\.label) == [
			"OpenAI",
			"Vercel AI Gateway",
		])
		#expect(store.catalogParentKey(for: "ai.openai") == SettingsItem.aiSectionKey)
		#expect(store.isCatalogChildKey("ai.openai"))
		#expect(!store.isCatalogChildKey(SettingsItem.aiSectionKey))
	}

	@Test("selecting the AI tab does not auto-select a provider")
	func selectAITabDoesNotAutoSelectProvider() {
		let store = ConfigureStore()
		store.settingsSections = [makeAISection()]
		store.selectTopLevelTab(SettingsItem.aiSectionKey)
		#expect(store.selectedNavKey == SettingsItem.aiSectionKey)
		#expect(store.settingsSelectedSection == nil)
	}

	@Test("AI catalog lists providers without auto-selecting one")
	func aiCatalogListsProvidersWithoutSelection() throws {
		let store = ConfigureStore()
		store.settingsSections = [makeAISection()]
		#expect(store.selectedNavKey == nil)
		var path: [String] = []
		let view = SettingsCatalogView(
			store: store,
			path: Binding(
				get: { path },
				set: { path = $0 }
			),
			title: "AI",
			subtitle: SettingsCatalogView.subtitle(for: SettingsItem.aiSectionKey, section: nil),
			systemImage: "sparkles",
			children: store.catalogChildren(for: SettingsItem.aiSectionKey),
			accessibilityCatalogId: "settings-ai-catalog",
			accessibilityRowPrefix: "settings-ai-row",
			fallbackIcon: "sparkles"
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-ai-catalog")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "OpenAI")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-ai-row-ai.openai")
		}
		#expect(path.isEmpty)
	}

	@Test("personas catalog uses a dedicated subtitle")
	func personasCatalogSubtitle() {
		#expect(
			SettingsCatalogView.subtitle(for: SettingsItem.personasSectionKey, section: nil)
				== SettingsItem.personasCatalogSubtitle
		)
		#expect(
			SettingsCatalogView.subtitle(
				for: SettingsItem.personasSectionKey,
				section: SettingsItem.personasSection
			) == SettingsItem.personasCatalogSubtitle
		)
	}

	@Test("untitled empty catalog shows the unavailable description")
	func untitledEmptyCatalogShowsUnavailable() throws {
		let store = ConfigureStore()
		var path: [String] = []
		let view = SettingsCatalogView(
			store: store,
			path: Binding(
				get: { path },
				set: { path = $0 }
			),
			title: "AI",
			subtitle: SettingsCatalogView.subtitle(for: SettingsItem.aiSectionKey, section: nil),
			systemImage: "sparkles",
			children: [],
			accessibilityCatalogId: "settings-ai-catalog",
			accessibilityRowPrefix: "settings-ai-row",
			fallbackIcon: "sparkles",
			emptyTitle: "No providers",
			emptyDescription: "No AI providers are available."
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-ai-catalog")
		}
		#expect(throws: Never.self) { try view.inspect().find(text: "No providers") }
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No AI providers are available.")
		}
	}

	@Test("settings window shows AI as a single sidebar row")
	func settingsWindowShowsAISidebarRow() throws {
		let store = ConfigureStore()
		store.settingsSections = [makeAISection()]
		let view = SettingsWindowView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-sidebar-ai")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "settings-sidebar-ai.openai")
		}
	}

	@Test("plugin nav key seeds a provider deep link")
	func providerNavKeySeedsDeepLink() {
		let store = ConfigureStore()
		store.settingsSections = [makeAISection()]
		RootSettingsNavigation.prepare(configureStore: store, navKey: "ai.openai")
		#expect(store.selectedNavKey == "ai.openai")
		#expect(store.catalogParentKey(for: "ai.openai") == SettingsItem.aiSectionKey)
	}

	@Test("AI catalog nav key stays on the catalog tab")
	func aiCatalogNavKeyStaysOnCatalog() {
		let store = ConfigureStore()
		store.settingsSections = [makeAISection()]
		RootSettingsNavigation.prepare(
			configureStore: store,
			navKey: SettingsItem.aiSectionKey
		)
		#expect(store.selectedNavKey == SettingsItem.aiSectionKey)
		#expect(store.settingsSelectedSection == nil)
	}

	@Test("AI catalog row renders provider icon URL")
	func aiCatalogRowRendersIconUrl() throws {
		let section = SettingsItem(
			label: "OpenAI",
			kind: .section,
			key: "ai.openai",
			navKey: "ai.openai",
			children: [],
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil,
			iconUrl: "/icons/ai/openai.png"
		)
		let view = SettingsCatalogRow(
			section: section,
			statusText: nil,
			fallbackIcon: "sparkles"
		)
		#expect(throws: Never.self) { try view.inspect().find(SidebarIconView.self) }
	}
}
