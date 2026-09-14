import AppKit
import SwiftUI

/// Tahoe-style Settings window: sidebar `NavigationSplitView` plus grouped
/// Form detail. Client-only panes (General, Sync, Personas) sit alongside
/// daemon-backed configure sections. Nested sections (e.g. AI providers) are
/// sidebar children, not a second inner split.
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

	private static let clientOnlyTabKeys: Set<String> = [
		SettingsItem.appearanceSectionKey,
		SettingsItem.iCloudSectionKey,
		SettingsItem.personasSectionKey,
	]

	private var clientSections: [SettingsItem] {
		[
			SettingsItem.appearanceSection,
			SettingsItem.iCloudSection,
			SettingsItem.personasSection,
		]
	}

	private var leafDaemonSections: [SettingsItem] {
		store.settingsSections.filter { !ConfigureTreeHelpers.hasNestedSections($0) }
	}

	private var nestedDaemonSections: [SettingsItem] {
		store.settingsSections.filter { ConfigureTreeHelpers.hasNestedSections($0) }
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

	private var sidebarSelection: Binding<String?> {
		Binding(
			get: { selectedTabKey },
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
		.onDisappear {
			Task { await store.flushPendingSave() }
		}
		.alert(
			store.pendingDelete?.title ?? "",
			isPresented: Binding(
				get: { store.pendingDelete != nil },
				set: { if !$0 { store.pendingDelete = nil } },
			),
		) {
			Button("Cancel", role: .cancel) {
				store.pendingDelete = nil
			}
			Button(store.pendingDelete?.confirmLabel ?? "Delete", role: .destructive) {
				Task { await store.confirmDelete() }
			}
		} message: {
			Text(store.pendingDelete?.message ?? "")
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
				ForEach(clientSections) { section in
					settingsSidebarRow(section)
				}
			}
			if !leafDaemonSections.isEmpty {
				Section {
					ForEach(leafDaemonSections) { section in
						settingsSidebarRow(section)
					}
				}
			}
			ForEach(nestedDaemonSections) { section in
				Section(section.displayLabel) {
					ForEach(ConfigureTreeHelpers.nestedSectionChildren(of: section)) { child in
						settingsSidebarRow(child)
					}
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
				PersonasSettingsView(store: store)
			} else if isICloudTab {
				ICloudSyncSettingsView()
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

	private var detailTitle: String {
		if isGeneralTab { return "General" }
		if isPersonasTab { return "Personas" }
		if isICloudTab { return "Sync" }
		if let section = store.settingsSelectedSection {
			return section.displayLabel
		}
		return "Settings"
	}

	private var restoredTabKey: String? {
		if Self.clientOnlyTabKeys.contains(lastTabKey) {
			return lastTabKey
		}
		if store.settingsSections.contains(where: {
			ConfigureTreeHelpers.sectionIdentityKey($0) == lastTabKey
		}) {
			return lastTabKey
		}
		for section in nestedDaemonSections {
			if ConfigureTreeHelpers.nestedSectionChildren(of: section).contains(where: {
				ConfigureTreeHelpers.sectionIdentityKey($0) == lastTabKey
			}) {
				return lastTabKey
			}
		}
		return SettingsItem.appearanceSectionKey
	}

	private func selectKey(_ key: String, recordHistory: Bool = true) {
		selectedTabKey = key
		lastTabKey = key
		if Self.clientOnlyTabKeys.contains(key) {
			store.selectedNavKey = nil
		} else if store.settingsSections.contains(where: {
			ConfigureTreeHelpers.sectionIdentityKey($0) == key
				&& ConfigureTreeHelpers.hasNestedSections($0)
		}) {
			store.selectTopLevelTab(key)
			if let child = store.selectedNavKey {
				selectedTabKey = child
				lastTabKey = child
			}
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
			store.selectedNavKey = nil
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
		if let child = store.selectedNavKey {
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
