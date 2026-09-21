import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
struct VercelAIGatewaySetupWizardViewTests {
    @Test("welcome explains setup before asking for credentials")
    func wizardChrome() throws {
        // Use a unique provider key so saved user progress cannot change this test.
        let view = VercelAIGatewaySetupWizardView(providerId: UUID().uuidString, onDismiss: {})
        let root = try view.inspect().find(viewWithAccessibilityIdentifier: "ai-provider-setup-wizard")
        _ = try root.find(text: "Give Toby its AI connection")
        _ = try root.find(text: "Get started")
        _ = try root.find(text: "I already have an API key")
    }

    @Test("resume preserves the step and provider but never the key")
    func resume() {
        let suite = "AISetupTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = AISetupStore(defaults: defaults)
        store.providerId = "openrouter"
        store.fields["apiKey"] = "secret"
        store.go(to: .connect)
        let resumed = AISetupStore(defaults: defaults)
        #expect(resumed.step == .connect)
        #expect(resumed.providerId == "openrouter")
        #expect(resumed.fields.isEmpty)
        #expect(!resumed.canSubmit)
    }

    @Test("a provider-specific settings entry keeps the requested provider")
    func explicitProvider() {
        let suite = "AISetupTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("openrouter", forKey: "aiSetup.provider.vercel")
        let store = AISetupStore(providerId: "vercel", restoreProvider: false, defaults: defaults)
        #expect(store.providerId == "vercel")
    }

    @Test("submission locks navigation")
    func submissionLocksNavigation() {
        let suite = "AISetupTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = AISetupStore(defaults: defaults)
        store.go(to: .connect)
        store.isSubmitting = true
        store.go(to: .welcome)
        #expect(store.step == .connect)
    }
}
