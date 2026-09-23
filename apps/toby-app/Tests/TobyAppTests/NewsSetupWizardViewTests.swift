import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
struct NewsSetupWizardViewTests {
	@Test("welcome explains Hacker News before asking for a Guardian key")
	func wizardChrome() throws {
		let suite = "NewsSetupTests.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: suite)!
		defer { defaults.removePersistentDomain(forName: suite) }
		let store = NewsSetupStore(defaults: defaults)
		let view = NewsSetupWizardView(store: store, onDismiss: {})
		let root = try view.inspect().find(viewWithAccessibilityIdentifier: "news-setup-wizard")
		_ = try root.find(text: "Set up news")
		_ = try root.find(text: "Get started")
		_ = try root.find(text: "Hacker News")
	}

	@Test("resume restores the step and source but never the API key")
	func resume() {
		let suite = "NewsSetupTests.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: suite)!
		defer { defaults.removePersistentDomain(forName: suite) }
		let store = NewsSetupStore(defaults: defaults)
		store.source = .guardian
		store.defaultSection = "science"
		store.apiKey = "secret-key"
		store.go(to: .guardian)
		let resumed = NewsSetupStore(defaults: defaults)
		#expect(resumed.step == .guardian)
		#expect(resumed.source == .guardian)
		#expect(resumed.defaultSection == "science")
		#expect(resumed.apiKey.isEmpty)
		#expect(!resumed.canConnect)
	}

	@Test("Hacker News can connect without a Guardian key")
	func hackerNewsDoesNotRequireKey() {
		let suite = "NewsSetupTests.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: suite)!
		defer { defaults.removePersistentDomain(forName: suite) }
		let store = NewsSetupStore(defaults: defaults)
		store.source = .hackerNews
		store.go(to: .guardian)
		#expect(store.canConnect)
		#expect(!store.requiresGuardianKey)
	}

	@Test("submission locks navigation")
	func submissionLocksNavigation() {
		let suite = "NewsSetupTests.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: suite)!
		defer { defaults.removePersistentDomain(forName: suite) }
		let store = NewsSetupStore(defaults: defaults)
		store.go(to: .guardian)
		store.isSubmitting = true
		store.go(to: .welcome)
		#expect(store.step == .guardian)
	}

	@Test("news settings route Setup Guide to the wizard")
	func settingsEntry() throws {
		let store = ConfigureStore()
		store.integrationLabels = ["news": "News"]
		store.integrationStatus["news"] = IntegrationStatus(
			name: "news",
			displayName: "News",
			description: nil,
			connected: false,
			pluginPath: nil,
			supportsSetup: false,
			setupDescription: nil,
			health: nil,
			authMethods: nil
		)
		let section = SettingsItem(
			label: "News",
			kind: .section,
			key: "news",
			navKey: "news",
			children: [],
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil
		)
		let view = ConfigureSectionDetailView(store: store, section: section)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "news-setup-guide-button")
		}
	}

}
