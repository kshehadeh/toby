import Foundation

/// Settings window preparation: select the right section before
/// `openWindow(id: "settings")`.
@MainActor
enum RootSettingsNavigation {
	/// Updates `configureStore` selection for the settings window. Caller opens the window.
	static func prepare(configureStore: ConfigureStore, navKey: String? = nil, personaName: String? = nil) {
		configureStore.pendingPersonaSelection = personaName
		if let navKey { configureStore.selectSection(navKey) }
	}
}
