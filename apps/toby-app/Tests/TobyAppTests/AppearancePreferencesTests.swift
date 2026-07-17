import AppKit
import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("AppearancePreferences")
struct AppearancePreferencesTests {
	@Test("defaults to system mode, orange accent, and general startup defaults")
	func defaultsToSystemAndOrange() {
		let suite = UserDefaults(suiteName: "toby.tests.appearance.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		#expect(prefs.mode == .system)
		#expect(prefs.accent == .orange)
		#expect(prefs.hideOnboarding == false)
		#expect(prefs.showDashboardEmail == true)
		#expect(prefs.showDashboardTasks == true)
		#expect(prefs.launchAtLogin == false)
		#expect(prefs.showMenuBarIcon == true)
		#expect(prefs.chatTranscriptMode == .normal)
		// System resolves to a concrete scheme (light or dark), never unspecified.
		#expect(prefs.preferredColorScheme == .light || prefs.preferredColorScheme == .dark)
		#expect(prefs.nsAppearance == nil)
	}

	@Test("mode maps to color scheme and NSAppearance")
	func modeMapsToSchemeAndAppearance() {
		let suite = UserDefaults(suiteName: "toby.tests.appearance.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(
			mode: .light, accent: .blue, defaults: suite, applyLaunchAtLoginOnChange: false
		)
		#expect(prefs.preferredColorScheme == .light)
		#expect(prefs.resolvedColorScheme == .light)
		#expect(prefs.nsAppearance?.name == .aqua)

		prefs.mode = .dark
		#expect(prefs.preferredColorScheme == .dark)
		#expect(prefs.resolvedColorScheme == .dark)
		#expect(prefs.nsAppearance?.name == .darkAqua)

		prefs.mode = .system
		// System mirrors OS — concrete light or dark, not nil.
		#expect(prefs.preferredColorScheme == AppearancePreferences.resolveColorScheme(for: .system))
		#expect(prefs.nsAppearance == nil)
	}

	@Test("resolveColorScheme maps light and dark explicitly")
	func resolveColorSchemeExplicitModes() {
		#expect(AppearancePreferences.resolveColorScheme(for: .light) == .light)
		#expect(AppearancePreferences.resolveColorScheme(for: .dark) == .dark)
	}

	@Test("persists mode, accent, hide onboarding, dashboard blocks, and general prefs to UserDefaults")
	func persistsModeAccentAndHideOnboarding() {
		let name = "toby.tests.appearance.\(UUID().uuidString)"
		let suite = UserDefaults(suiteName: name)!

		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		prefs.mode = .light
		prefs.accent = .teal
		prefs.hideOnboarding = true
		prefs.showDashboardEmail = false
		prefs.showDashboardTasks = false
		prefs.launchAtLogin = true
		prefs.showMenuBarIcon = false
		prefs.chatTranscriptMode = .debug
		#expect(suite.string(forKey: AppearancePreferences.modeDefaultsKey) == "light")
		#expect(suite.string(forKey: AppearancePreferences.accentDefaultsKey) == "teal")
		#expect(suite.bool(forKey: AppearancePreferences.hideOnboardingDefaultsKey) == true)
		#expect(suite.bool(forKey: AppearancePreferences.showDashboardEmailDefaultsKey) == false)
		#expect(suite.bool(forKey: AppearancePreferences.showDashboardTasksDefaultsKey) == false)
		#expect(suite.bool(forKey: AppearancePreferences.launchAtLoginDefaultsKey) == true)
		#expect(suite.bool(forKey: AppearancePreferences.showMenuBarIconDefaultsKey) == false)
		#expect(suite.string(forKey: AppearancePreferences.chatTranscriptModeDefaultsKey) == "debug")

		let reloaded = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		#expect(reloaded.mode == .light)
		#expect(reloaded.accent == .teal)
		#expect(reloaded.hideOnboarding == true)
		#expect(reloaded.showDashboardEmail == false)
		#expect(reloaded.showDashboardTasks == false)
		#expect(reloaded.launchAtLogin == true)
		#expect(reloaded.showMenuBarIcon == false)
		#expect(reloaded.chatTranscriptMode == .debug)
		#expect(reloaded.resolvedColorScheme == .light)
	}

	@Test("general settings view shows launch at login, menu bar, and chat mode controls")
	func generalSettingsShowsStartupAndMenuBarToggles() throws {
		let suite = UserDefaults(suiteName: "toby.tests.appearance.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		let view = AppearanceSettingsView(preferences: prefs)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Start at login")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Show menu bar icon")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Chat mode")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "general-launch-at-login-toggle")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "general-show-menu-bar-icon-toggle")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "general-chat-mode-picker")
		}
	}

	@Test("ThemeResolution.isDark follows mode UserDefaults")
	func themeResolutionFollowsMode() {
		let previous = UserDefaults.standard.string(forKey: AppearanceDefaultsKey.mode)
		defer {
			if let previous {
				UserDefaults.standard.set(previous, forKey: AppearanceDefaultsKey.mode)
			} else {
				UserDefaults.standard.removeObject(forKey: AppearanceDefaultsKey.mode)
			}
		}

		UserDefaults.standard.set("light", forKey: AppearanceDefaultsKey.mode)
		#expect(ThemeResolution.isDark == false)

		UserDefaults.standard.set("dark", forKey: AppearanceDefaultsKey.mode)
		#expect(ThemeResolution.isDark == true)
	}

	@Test("settings window shows General tab by default")
	func settingsWindowShowsGeneralTab() throws {
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
			try view.inspect().find(text: "General")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(AppearanceSettingsView.self)
		}
		#expect(SettingsItem.appearanceSection.label == "General")
		#expect(SettingsSidebarIcon.systemName(for: .appearanceSection) == "gearshape")
	}

	@Test("general settings view does not host hide onboarding toggle")
	func generalSettingsDoesNotHostHideOnboardingToggle() throws {
		let suite = UserDefaults(suiteName: "toby.tests.appearance.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		let view = AppearanceSettingsView(preferences: prefs)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-hide-onboarding-toggle")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "Hide onboarding checklist")
		}
	}

	@Test("dashboard settings section shows block visibility and hide onboarding toggles")
	func dashboardSettingsShowsHideOnboardingToggle() throws {
		let suite = UserDefaults(suiteName: "toby.tests.appearance.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		let store = ConfigureStore()
		let section = SettingsItem(
			label: "Dashboard",
			kind: .section,
			key: "dashboard",
			navKey: "dashboard",
			children: [],
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil
		)
		let view = ConfigureSectionDetailView(
			store: store,
			section: section,
			appearancePreferences: prefs
		)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Show unread mail")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Show tasks")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-show-email-toggle")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-show-tasks-toggle")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Hide onboarding checklist")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "dashboard-hide-onboarding-toggle")
		}
	}

	@Test("dashboard block visibility helpers update preferences")
	func dashboardBlockVisibilityHelpers() {
		let suite = UserDefaults(suiteName: "toby.tests.appearance.\(UUID().uuidString)")!
		let prefs = AppearancePreferences(defaults: suite, applyLaunchAtLoginOnChange: false)
		#expect(prefs.isDashboardBlockVisible(.email))
		#expect(prefs.isDashboardBlockVisible(.tasks))
		prefs.setDashboardBlockVisible(.email, visible: false)
		#expect(!prefs.isDashboardBlockVisible(.email))
		#expect(prefs.showDashboardEmail == false)
		prefs.setDashboardBlockVisible(.tasks, visible: false)
		#expect(!prefs.isDashboardBlockVisible(.tasks))
		#expect(prefs.showDashboardTasks == false)
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
		for mode in ChatTranscriptMode.allCases {
			#expect(!mode.displayName.isEmpty)
		}
	}
}
