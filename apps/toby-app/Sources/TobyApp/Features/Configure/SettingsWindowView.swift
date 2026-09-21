import AppKit
import SwiftUI

/// Tahoe-style Settings window: sidebar `NavigationSplitView` plus grouped
/// Form detail. Client-only panes (General, Personas, Sync, Integrations) are
/// interleaved with daemon-backed configure sections. Nested sections (Personas,
/// Integrations, AI) are catalog tabs that push child detail in a `NavigationStack`.
struct SettingsWindowView: View {
	@Bindable var store: ConfigureStore
	/// Soft-resets the app onto a new Toby data root (`nil` = default `~/.toby`).
	var onSwitchTobyHome: ((String?) async throws -> Void)? = nil
	@State private var appearancePreferences = AppearancePreferences.shared
	/// Sidebar selection. Client-only keys never go through the configure store.
	@State private var selectedTabKey: String = SettingsItem.appearanceSectionKey
	@AppStorage(AppearanceDefaultsKey.settingsLastTab)
	private var lastTabKey = SettingsItem.appearanceSectionKey
	@State private var isRestoringTab = false
	@State private var navigationHistory: [String] = [SettingsItem.appearanceSectionKey]
	@State private var historyIndex = 0
	@State private var isHistoryNavigation = false

	@State private var catalogPath: [String] = []

	private static let clientOnlyTabKeys: Set<String> = [
		SettingsItem.appearanceSectionKey,
		SettingsItem.iCloudSectionKey,
		SettingsItem.personasSectionKey,
		SettingsItem.integrationsSectionKey,
	]

	/// Sidebar row order (client-only + daemon-backed).
	private static let sidebarOrder: [String] = [
		SettingsItem.appearanceSectionKey, // General
		"dashboard", // Home
		SettingsItem.aiSectionKey, // AI
		"library", // Library
		SettingsItem.personasSectionKey, // Personas
		"chatInbound", // Chat
		SettingsItem.iCloudSectionKey, // Sync
		SettingsItem.integrationsSectionKey, // Integrations
		"defaults", // Providers
		"transcription",
		"webSearch",
		"weather",
	]

	private var clientSections: [SettingsItem] {
		[
			SettingsItem.appearanceSection,
			SettingsItem.personasSection,
			SettingsItem.iCloudSection,
			SettingsItem.integrationsSection,
		]
	}

	private var orderedSidebarSections: [SettingsItem] {
		let clientByKey = Dictionary(
			uniqueKeysWithValues: clientSections.map {
				(ConfigureTreeHelpers.sectionIdentityKey($0), $0)
			}
		)
		let daemonByKey = Dictionary(
			uniqueKeysWithValues: store.settingsSections.map {
				(ConfigureTreeHelpers.sectionIdentityKey($0), $0)
			}
		)
		return Self.sidebarOrder.compactMap { key in
			if let client = clientByKey[key] {
				return client
			}
			return daemonByKey[key]
		}
	}

	private var isGeneralTab: Bool {
		selectedTabKey == SettingsItem.appearanceSectionKey
	}

	private var isPersonasTab: Bool {
		selectedTabKey == SettingsItem.personasSectionKey
	}

	private var isICloudTab: Bool {
		selectedTabKey == SettingsItem.iCloudSectionKey
	}

	private var isIntegrationsTab: Bool {
		selectedTabKey == SettingsItem.integrationsSectionKey
	}

	private var isAITab: Bool {
		selectedTabKey == SettingsItem.aiSectionKey
	}

	private var isCatalogTab: Bool {
		isIntegrationsTab || isPersonasTab || store.isCatalogSectionKey(selectedTabKey)
	}

	private var sidebarSelection: Binding<String?> {
		Binding(
			get: {
				if let parent = store.catalogParentKey(for: selectedTabKey) {
					return parent
				}
				return selectedTabKey
			},
			set: { newValue in
				guard let newValue else { return }
				selectKey(newValue)
			}
		)
	}

	private var canGoBack: Bool { historyIndex > 0 }
	private var canGoForward: Bool { historyIndex < navigationHistory.count - 1 }

	var body: some View {
		NavigationSplitView(columnVisibility: .constant(.all)) {
			settingsSidebar
				.navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 240)
				.toolbar(removing: .sidebarToggle)
		} detail: {
			settingsDetail
				.navigationTitle(detailTitle)
				.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		}
		.navigationTitle("Settings")
		.navigationSplitViewStyle(.balanced)
		.frame(minWidth: 700, minHeight: 480)
		.toolbar {
			ToolbarItemGroup(placement: .navigation) {
				Button {
					goBack()
				} label: {
					Image(systemName: "chevron.backward")
				}
				.disabled(!canGoBack)
				.help("Back")
				.accessibilityLabel("Back")
				.accessibilityIdentifier("settings-nav-back")

				Button {
					goForward()
				} label: {
					Image(systemName: "chevron.forward")
				}
				.disabled(!canGoForward)
				.help("Forward")
				.accessibilityLabel("Forward")
				.accessibilityIdentifier("settings-nav-forward")
			}
		}
		.background {
			WindowAccessor { window in
				window.styleMask.insert(.fullSizeContentView)
				window.toolbarStyle = .unified
				window.isMovableByWindowBackground = true
			}
		}
		.task {
			isRestoringTab = true
			let requestedNavKey = store.selectedNavKey
			await store.loadSettingsSections()
			if requestedNavKey != nil {
				syncTabFromStoreSelection()
			} else if let restoredKey = restoredTabKey {
				selectKey(restoredKey, recordHistory: false)
			}
			isRestoringTab = false
		}
		.onChange(of: store.selectedNavKey) { _, newKey in
			guard !isRestoringTab, newKey != nil else { return }
			syncTabFromStoreSelection()
		}
		.onChange(of: catalogPath) { _, newPath in
			guard !isRestoringTab, !isHistoryNavigation, isCatalogTab else { return }
			if isPersonasTab {
				lastTabKey = SettingsItem.personasSectionKey
				recordNavigation(newPath.last ?? SettingsItem.personasSectionKey)
				return
			}
			if let key = newPath.last {
				if store.selectedNavKey != key {
					store.selectSection(key)
				}
				lastTabKey = key
				recordNavigation(key)
			} else {
				store.selectCatalogHome()
				lastTabKey = selectedTabKey
				recordNavigation(selectedTabKey)
			}
		}
		.onDisappear {
			Task { await store.flushPendingSave() }
		}
		.alert(
			store.pendingDelete?.title ?? "",
			isPresented: Binding(
				get: { store.pendingDelete != nil },
				set: { if !$0 { store.pendingDelete = nil } },
			),
			presenting: store.pendingDelete,
		) { pending in
			Button("Cancel", role: .cancel) {
				store.pendingDelete = nil
			}
			Button(pending.confirmLabel, role: .destructive) {
				Task { await store.confirmDelete(pending) }
			}
		} message: { pending in
			Text(pending.message)
		}
		.sheet(
			isPresented: Binding(
				get: { store.setupGuidePresented },
				set: { if !$0 { store.dismissSetupGuide() } },
			),
		) {
			if let section = store.settingsSelectedSection ?? store.selectedSection {
				IntegrationSetupWizardView(store: store, section: section)
			}
		}
	}

	private var settingsSidebar: some View {
		List(selection: sidebarSelection) {
			Section {
				ForEach(orderedSidebarSections) { section in
					settingsSidebarRow(section)
				}
			}
		}
		.listStyle(.sidebar)
		.scrollEdgeEffectStyleSoftIfAvailable()
		.navigationTitle("Settings")
		.accessibilityIdentifier("settings-sidebar")
		.tobyThemeRefreshable()
	}

	private func settingsSidebarRow(_ section: SettingsItem) -> some View {
		let key = ConfigureTreeHelpers.sectionIdentityKey(section)
		return Label {
			Text(section.displayLabel)
		} icon: {
			Image(systemName: SettingsSidebarIcon.systemName(for: section))
		}
		.tag(key)
		.accessibilityIdentifier("settings-sidebar-\(key)")
	}

	@ViewBuilder
	private var settingsDetail: some View {
		Group {
			if isGeneralTab {
				AppearanceSettingsView(
					preferences: appearancePreferences,
					onSwitchTobyHome: onSwitchTobyHome
				)
			} else if isPersonasTab {
				PersonasSettingsView(store: store, path: $catalogPath)
			} else if isICloudTab {
				ICloudSyncSettingsView()
			} else if isIntegrationsTab {
				IntegrationsSettingsView(store: store, path: $catalogPath)
			} else if isAITab {
				AISettingsView(store: store, path: $catalogPath)
			} else if store.isCatalogSectionKey(selectedTabKey) {
				catalogDetail
			} else if let errorMessage = store.errorMessage,
				store.settingsSections.isEmpty
			{
				ContentUnavailableView {
					Label("Configuration unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else {
				ConfigureDetailView(store: store)
			}
		}
		.tobyThemeRefreshable()
	}

	@ViewBuilder
	private var catalogDetail: some View {
		let catalog = store.catalogSection(for: selectedTabKey)
		let title = catalog?.displayLabel ?? "Settings"
		let icon = catalog.map { SettingsSidebarIcon.systemName(for: $0) } ?? "sparkles"
		SettingsCatalogView(
			store: store,
			path: $catalogPath,
			title: title,
			subtitle: SettingsCatalogView.subtitle(for: selectedTabKey, section: catalog),
			systemImage: icon,
			children: store.catalogChildren(for: selectedTabKey),
			accessibilityCatalogId: "settings-\(selectedTabKey)-catalog",
			accessibilityRowPrefix: "settings-\(selectedTabKey)-row",
			fallbackIcon: icon,
			loadingTitle: "Loading…",
			unavailableTitle: "\(title) unavailable",
			emptyTitle: "No \(title.lowercased())",
			emptyDescription: "Nothing is available in this section yet."
		)
	}

	private var detailTitle: String {
		if isGeneralTab { return "General" }
		if isPersonasTab {
			if let key = catalogPath.last {
				return PersonasSettingsNavigation.title(for: key)
			}
			return "Personas"
		}
		if isICloudTab { return "Sync" }
		if isCatalogTab {
			if let key = catalogPath.last {
				return store.catalogChildren(for: selectedTabKey).first {
					ConfigureTreeHelpers.sectionIdentityKey($0) == key
				}?.displayLabel
					?? store.settingsSelectedSection?.displayLabel
					?? catalogTitle
			}
			return catalogTitle
		}
		if let section = store.settingsSelectedSection {
			return section.displayLabel
		}
		return "Settings"
	}

	private var catalogTitle: String {
		store.catalogSection(for: selectedTabKey)?.displayLabel
			?? (isIntegrationsTab ? "Integrations" : "Settings")
	}

	private var restoredTabKey: String? {
		if PersonasSettingsNavigation.isPathKey(lastTabKey) {
			return lastTabKey
		}
		if Self.clientOnlyTabKeys.contains(lastTabKey) {
			return lastTabKey
		}
		if store.isCatalogChildKey(lastTabKey) || store.isCatalogSectionKey(lastTabKey) {
			return lastTabKey
		}
		if store.settingsSections.contains(where: {
			ConfigureTreeHelpers.sectionIdentityKey($0) == lastTabKey
		}) {
			return lastTabKey
		}
		return SettingsItem.appearanceSectionKey
	}

	private func selectKey(_ key: String, recordHistory: Bool = true) {
		if PersonasSettingsNavigation.isPathKey(key) {
			selectedTabKey = SettingsItem.personasSectionKey
			lastTabKey = SettingsItem.personasSectionKey
			catalogPath = PersonasSettingsNavigation.isChildKey(key) ? [key] : []
			store.selectedNavKey = nil
			if recordHistory {
				recordNavigation(key)
			}
			return
		}

		if store.isCatalogSectionKey(key) || store.isCatalogChildKey(key) {
			let parent = store.catalogParentKey(for: key) ?? key
			selectedTabKey = parent
			lastTabKey = key
			if key == parent {
				catalogPath = []
				store.selectCatalogHome()
			} else {
				catalogPath = [key]
				store.selectSection(key)
			}
			if recordHistory {
				recordNavigation(key)
			}
			return
		}

		selectedTabKey = key
		lastTabKey = key
		if !catalogPath.isEmpty {
			catalogPath = []
		}
		if Self.clientOnlyTabKeys.contains(key) {
			store.selectedNavKey = nil
		} else {
			store.selectSection(key)
		}
		if recordHistory {
			recordNavigation(selectedTabKey)
		}
	}

	private func syncTabFromStoreSelection() {
		if selectedTabKey == SettingsItem.appearanceSectionKey,
			store.selectedNavKey == nil
		{
			return
		}
		if let key = store.selectedNavKey, Self.clientOnlyTabKeys.contains(key) {
			selectedTabKey = key
			lastTabKey = key
			if key == SettingsItem.personasSectionKey || store.isCatalogSectionKey(key) {
				catalogPath = []
			}
			store.selectedNavKey = nil
			recordNavigation(key)
			return
		}
		if let key = store.selectedNavKey, store.isCatalogSectionKey(key) {
			selectedTabKey = key
			lastTabKey = key
			catalogPath = []
			store.selectedNavKey = nil
			recordNavigation(key)
			return
		}
		if let key = store.selectedNavKey, let parent = store.catalogParentKey(for: key) {
			selectedTabKey = parent
			lastTabKey = key
			catalogPath = [key]
			recordNavigation(key)
			return
		}
		if let key = store.selectedNavKey {
			selectedTabKey = key
			lastTabKey = key
			recordNavigation(key)
			return
		}
		guard let key = store.selectedTopLevelKey,
			store.settingsSections.contains(where: {
				ConfigureTreeHelpers.sectionIdentityKey($0) == key
			})
		else { return }
		selectedTabKey = key
		lastTabKey = key
		store.selectTopLevelTab(key)
		if let child = store.selectedNavKey, !store.isCatalogSectionKey(child) {
			selectedTabKey = child
			lastTabKey = child
		}
		recordNavigation(selectedTabKey)
	}

	private func recordNavigation(_ key: String) {
		guard !isHistoryNavigation else { return }
		if navigationHistory.indices.contains(historyIndex),
			navigationHistory[historyIndex] == key
		{
			return
		}
		if historyIndex < navigationHistory.count - 1 {
			navigationHistory = Array(navigationHistory.prefix(historyIndex + 1))
		}
		navigationHistory.append(key)
		historyIndex = navigationHistory.count - 1
	}

	private func goBack() {
		guard canGoBack else { return }
		isHistoryNavigation = true
		historyIndex -= 1
		selectKey(navigationHistory[historyIndex], recordHistory: false)
		isHistoryNavigation = false
	}

	private func goForward() {
		guard canGoForward else { return }
		isHistoryNavigation = true
		historyIndex += 1
		selectKey(navigationHistory[historyIndex], recordHistory: false)
		isHistoryNavigation = false
	}
}
