import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
struct EmailSetupWizardViewTests {
	@Test("welcome explains discovery before asking for a password")
	func wizardChrome() throws {
		let suite = "EmailSetupTests.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: suite)!
		defer { defaults.removePersistentDomain(forName: suite) }
		let store = EmailSetupStore(defaults: defaults)
		let view = EmailSetupWizardView(store: store, onDismiss: {})
		let root = try view.inspect().find(viewWithAccessibilityIdentifier: "email-setup-wizard")
		_ = try root.find(text: "Set up email")
		_ = try root.find(text: "Get started")
		_ = try root.find(text: "Enter your address")
	}

	@Test("resume restores the step and address but never the password")
	func resume() {
		let suite = "EmailSetupTests.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: suite)!
		defer { defaults.removePersistentDomain(forName: suite) }
		let store = EmailSetupStore(defaults: defaults)
		store.email = "ada@fastmail.com"
		store.password = "secret"
		store.smtpPassword = "other-secret"
		store.go(to: .credentials)
		let resumed = EmailSetupStore(defaults: defaults)
		#expect(resumed.step == .credentials)
		#expect(resumed.email == "ada@fastmail.com")
		#expect(resumed.password.isEmpty)
		#expect(resumed.smtpPassword.isEmpty)
		#expect(!resumed.canConnect)
	}

	@Test("an existing username opens the account step")
	func initialEmailSkipsWelcome() {
		let suite = "EmailSetupTests.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: suite)!
		defer { defaults.removePersistentDomain(forName: suite) }
		let store = EmailSetupStore(initialEmail: "ada@fastmail.com", defaults: defaults)
		#expect(store.step == .account)
		#expect(store.email == "ada@fastmail.com")
		#expect(store.canDiscover)
	}

	@Test("submission locks navigation")
	func submissionLocksNavigation() {
		let suite = "EmailSetupTests.\(UUID().uuidString)"
		let defaults = UserDefaults(suiteName: suite)!
		defer { defaults.removePersistentDomain(forName: suite) }
		let store = EmailSetupStore(defaults: defaults)
		store.go(to: .credentials)
		store.isSubmitting = true
		store.go(to: .welcome)
		#expect(store.step == .credentials)
	}

	@Test("email settings offer guided setup until the account is connected")
	func settingsEntry() throws {
		let store = ConfigureStore()
		store.integrationLabels = ["email": "Email (IMAP/SMTP)"]
		store.integrationStatus["email"] = IntegrationStatus(
			name: "email",
			displayName: "Email (IMAP/SMTP)",
			description: nil,
			connected: false,
			pluginPath: nil,
			supportsSetup: false,
			setupDescription: nil,
			health: nil,
			authMethods: nil
		)
		let section = SettingsItem(
			label: "Email (IMAP/SMTP)",
			kind: .section,
			key: "email",
			navKey: "email",
			children: [],
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil
		)
		let disconnected = ConfigureSectionDetailView(store: store, section: section)
		#expect(throws: Never.self) {
			try disconnected.inspect().find(button: "Start setup")
		}

		store.integrationStatus["email"] = IntegrationStatus(
			name: "email",
			displayName: "Email (IMAP/SMTP)",
			description: nil,
			connected: true,
			pluginPath: nil,
			supportsSetup: false,
			setupDescription: nil,
			health: nil,
			authMethods: nil
		)
		let connected = ConfigureSectionDetailView(store: store, section: section)
		#expect(throws: (any Error).self) {
			try connected.inspect().find(button: "Start setup")
		}
	}
}
