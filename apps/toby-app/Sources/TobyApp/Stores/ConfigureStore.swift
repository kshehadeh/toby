import Foundation
import Observation

/// Settings window navigation: which section to open (deep links from the
/// app, command palette, and menu bar) and a persona to select.
@Observable
@MainActor
final class ConfigureStore {
	/// A section key to open (`NativeSettingsSection` raw value or a legacy key).
	var selectedNavKey: String?
	/// A persona the Personas pane should open.
	var pendingPersonaSelection: String?

	func selectSection(_ key: String) { selectedNavKey = key }

	func resetForHomeSwitch() {
		selectedNavKey = nil
		pendingPersonaSelection = nil
	}
}
