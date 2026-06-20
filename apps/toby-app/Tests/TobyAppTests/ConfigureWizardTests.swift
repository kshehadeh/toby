import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("IntegrationSetupWizard")
struct ConfigureWizardTests {
	@Test("decodes setup guide from JSON")
	func decodeSetupGuide() throws {
		let json = """
		{
			"ok": true,
			"name": "gmail",
			"displayName": "Gmail",
			"description": "Connect to Gmail",
			"steps": [
				{
					"id": "overview",
					"title": "What Gmail can do",
					"description": "Read and organize email."
				},
				{
					"id": "provider",
					"title": "Create a Google Cloud app",
					"links": [
						{ "label": "Google Cloud Console", "url": "https://console.cloud.google.com/" }
					],
					"artifacts": [
						{
							"id": "redirectUri",
							"label": "Redirect URI",
							"value": "http://localhost:9876/callback",
							"hint": "Add to Google Cloud."
						}
					]
				}
			]
		}
		"""
		let data = try #require(json.data(using: .utf8))
		let guide = try JSONDecoder().decode(IntegrationSetupGuide.self, from: data)
		#expect(guide.ok)
		#expect(guide.name == "gmail")
		#expect(guide.displayName == "Gmail")
		#expect(guide.steps?.count == 2)
		#expect(guide.steps?[0].id == "overview")
		#expect(guide.steps?[1].links?.first?.label == "Google Cloud Console")
		#expect(guide.steps?[1].artifacts?.first?.id == "redirectUri")
	}

	@Test("wizard renders guide title and steps")
	func wizardRendersGuide() throws {
		let store = ConfigureStore()
		store.setupGuidePresented = true
		store.setupGuide = IntegrationSetupGuide(
			ok: true,
			name: "sample",
			displayName: "Sample Plugin",
			description: "Demo plugin",
			steps: [
				IntegrationSetupGuideStep(
					id: "overview",
					title: "What Sample Plugin can do",
					description: "Demo.",
					links: nil,
					artifacts: nil
				),
			],
			error: nil
		)
		store.selectedNavKey = "sample"

		let section = SettingsItem(
			label: "Sample Plugin",
			kind: .section,
			key: "sample",
			navKey: nil,
			children: [],
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil
		)
		let view = IntegrationSetupWizardView(store: store, section: section)
		let title = try view.inspect().find(text: "Sample Plugin")
		#expect(try title.string() == "Sample Plugin")
		#expect(throws: Never.self) { try view.inspect().find(text: "What Sample Plugin can do") }
	}
}
