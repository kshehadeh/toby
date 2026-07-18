import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
struct VercelAIGatewaySetupWizardViewTests {
	@Test("wizard root chrome is identifiable")
	func wizardChrome() throws {
		let view = VercelAIGatewaySetupWizardView(providerId: "vercel", onDismiss: {})
		// Prefer text + root id: SF Symbols without accessibilityLabel add
		// AccessibilityImageLabel modifiers that block ViewInspector find().
		// Guide content comes from the daemon — no offline provider-specific fallback.
		let root = try view.inspect().find(
			viewWithAccessibilityIdentifier: "ai-provider-setup-wizard"
		)
		#expect(throws: Never.self) {
			_ = try root.find(text: "Validate & connect")
		}
		#expect(throws: Never.self) {
			_ = try root.find(text: "Use another provider…")
		}
	}
}
