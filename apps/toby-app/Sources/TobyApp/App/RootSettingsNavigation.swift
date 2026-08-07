import Foundation

/// Pure-ish settings window preparation: select the right configure tab / section
/// before `openWindow(id: "settings")`.
@MainActor
enum RootSettingsNavigation {
	static let clientOnlySettingsTabKeys: Set<String> = [
		SettingsItem.appearanceSectionKey,
		SettingsItem.personasSectionKey,
	]

	/// Updates `configureStore` selection for the settings window. Caller opens the window.
	static func prepare(
		configureStore: ConfigureStore,
		navKey: String? = nil,
		personaName: String? = nil,
	) {
		configureStore.pendingPersonaSelection = personaName
		guard let navKey else { return }

		let isClientTab = clientOnlySettingsTabKeys.contains(navKey)
		if configureStore.isSettingsMode && !isClientTab {
			// Prefer top-level tab selection once sections are loaded (so nested
			// containers like AI land on the tab + first child). Otherwise seed
			// selectedNavKey so loadSettingsSections / syncTabFromStoreSelection
			// pick the right tab after the window opens.
			let isTopLevel = configureStore.settingsSections.contains {
				ConfigureTreeHelpers.sectionIdentityKey($0) == navKey
			}
			if isTopLevel {
				configureStore.selectTopLevelTab(navKey)
			} else {
				configureStore.selectSection(navKey)
			}
		} else {
			configureStore.selectedNavKey = navKey
		}
	}
}
