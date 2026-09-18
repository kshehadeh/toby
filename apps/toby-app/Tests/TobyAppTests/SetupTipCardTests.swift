import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("SetupTipCard")
struct SetupTipCardTests {
	@Test("renders title and optional learn more action")
	func rendersTitleAndLearnMore() throws {
		let view = SetupTipCard(
			tipId: "test-setup-tip",
			title: "Set up OpenAI",
			message: "Create an API key, then paste it here.",
			actionTitle: "How to get an API key",
			actionURL: URL(string: "https://platform.openai.com/api-keys"),
			accessibilityId: "ai-provider-setup-help"
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "ai-provider-setup-help")
		}
		let card = try view.inspect().find(SetupTipCard.self).actualView()
		#expect(card.title == "Set up OpenAI")
		#expect(card.message == "Create an API key, then paste it here.")
		#expect(card.actionTitle == "How to get an API key")
		#expect(card.actionURL?.absoluteString == "https://platform.openai.com/api-keys")
	}

	@Test("AI provider help uses a setup title and docs link")
	func aiProviderHelpUsesSetupTitle() throws {
		let section = SettingsItem(
			label: "OpenAI",
			kind: .section,
			key: "ai.openai",
			navKey: "ai.openai",
			children: nil,
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil,
			description: "Paste a secret key from platform.openai.com.",
			docUrl: "https://platform.openai.com/api-keys"
		)
		let view = AIProviderSetupHelpView(section: section)
		let card = try view.inspect().find(SetupTipCard.self).actualView()
		#expect(card.title == "Set up OpenAI")
		#expect(card.message == "Paste a secret key from platform.openai.com.")
		#expect(card.actionTitle == "How to get an API key")
	}
}
