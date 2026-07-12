import AppKit
import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("AppearancePreferences")
struct AppearancePreferencesTests {
	@Test("defaults to system mode and orange accent")
	func defaultsToSystemAndOrange() {
		let suite = UserDefaults(suiteName: "toby.tests.appearance.\(UUID().uuidString)")!
		defer { suite.removePersistentDomain(forName: suite.dictionaryRepresentation().keys.first ?? "") }

		let prefs = AppearancePreferences(defaults: suite)
		#expect(prefs.mode == .system)
		#expect(prefs.accent == .orange)
		#expect(prefs.preferredColorScheme == nil)
		#expect(prefs.nsAppearance == nil)
	}

	@Test("mode maps to color scheme and NSAppearance")
	func modeMapsToSchemeAndAppearance() {
		let suite = UserDefaults(suiteName: "toby.tests.appearance.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(mode: .light, accent: .blue, defaults: suite)
		#expect(prefs.preferredColorScheme == .light)
		#expect(prefs.nsAppearance?.name == .aqua)

		prefs.mode = .dark
		#expect(prefs.preferredColorScheme == .dark)
		#expect(prefs.nsAppearance?.name == .darkAqua)

		prefs.mode = .system
		#expect(prefs.preferredColorScheme == nil)
		#expect(prefs.nsAppearance == nil)
	}

	@Test("persists mode and accent to UserDefaults")
	func persistsModeAndAccent() {
		let name = "toby.tests.appearance.\(UUID().uuidString)"
		let suite = UserDefaults(suiteName: name)!

		let prefs = AppearancePreferences(defaults: suite)
		prefs.mode = .light
		prefs.accent = .teal
		#expect(suite.string(forKey: AppearancePreferences.modeDefaultsKey) == "light")
		#expect(suite.string(forKey: AppearancePreferences.accentDefaultsKey) == "teal")

		let reloaded = AppearancePreferences(defaults: suite)
		#expect(reloaded.mode == .light)
		#expect(reloaded.accent == .teal)
	}

	@Test("settings window shows appearance tab by default")
	func settingsWindowShowsAppearanceTab() throws {
		let store = ConfigureStore()
		store.settingsSections = [
			SettingsItem(
				label: "Chat", kind: .section, key: "chatInbound",
				navKey: nil, children: [],
				masked: nil, multiline: nil, options: nil, selectChoices: nil,
				currentValue: nil, selectedValues: nil, readOnly: nil
			),
		]
		let view = SettingsWindowView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Appearance")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(AppearanceSettingsView.self)
		}
		#expect(SettingsSidebarIcon.systemName(for: .appearanceSection) == "paintpalette")
	}

	@Test("monochrome AI icon URLs use template rendering")
	func monochromeAIIconsAreTemplate() {
		let ai = URL(string: "http://127.0.0.1:7847/icons/ai/openai.png")!
		#expect(SidebarIconView.rendering(for: ai) == .template)

		let macos = URL(string: "http://127.0.0.1:7847/api/plugins/macos/icon")!
		#expect(SidebarIconView.rendering(for: macos) == .template)

		// Filled art / brand icons must stay original (template → solid boxes).
		let reminders = URL(string: "http://127.0.0.1:7847/api/plugins/applereminders/icon")!
		#expect(SidebarIconView.rendering(for: reminders) == .original)

		let slack = URL(string: "http://127.0.0.1:7847/api/plugins/slack/icon")!
		#expect(SidebarIconView.rendering(for: slack) == .original)
	}

	@Test("all accent presets have display names")
	func accentPresetsHaveNames() {
		for preset in AccentPreset.allCases {
			#expect(!preset.displayName.isEmpty)
		}
		for mode in AppearanceMode.allCases {
			#expect(!mode.displayName.isEmpty)
		}
	}
}
