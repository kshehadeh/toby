import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
struct AIProviderSetupChooserViewTests {
	@Test("chooser lists vercel and openrouter options")
	func chooserOptions() throws {
		var selected: String?
		let view = AIProviderSetupChooserView(
			onSelect: { selected = $0 },
			onDismiss: {},
			onBrowseAllProviders: {}
		)
		let root = try view.inspect().find(
			viewWithAccessibilityIdentifier: "ai-provider-setup-chooser"
		)
		#expect(throws: Never.self) {
			_ = try root.find(text: "Vercel AI Gateway")
		}
		#expect(throws: Never.self) {
			_ = try root.find(text: "OpenRouter")
		}
		#expect(throws: Never.self) {
			_ = try root.find(text: "Recommended")
		}

		let openRouter = try view.inspect().find(
			viewWithAccessibilityIdentifier: "ai-provider-chooser-openrouter"
		).button()
		try openRouter.tap()
		#expect(selected == "openrouter")
	}
}
