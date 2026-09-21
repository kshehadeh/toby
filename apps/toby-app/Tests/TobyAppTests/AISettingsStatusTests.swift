import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("AISettingsStatus")
struct AISettingsStatusTests {
	private func aiProviderSection(
		label: String = "Vercel AI Gateway",
		key: String = "ai.vercel"
	) -> SettingsItem {
		var item = SettingsItem(
			label: label,
			kind: .section,
			key: key,
			navKey: key,
			children: [
				SettingsItem(
					label: "API Key",
					kind: .value,
					key: "\(key).apiKey",
					navKey: "\(key).apiKey",
					children: nil,
					masked: true,
					multiline: nil,
					options: nil,
					selectChoices: nil,
					currentValue: nil,
					selectedValues: nil,
					readOnly: nil
				),
			],
			masked: nil,
			multiline: nil,
			options: nil,
			selectChoices: nil,
			currentValue: nil,
			selectedValues: nil,
			readOnly: nil
		)
		item.description = "Route models through Vercel AI Gateway."
		return item
	}

	@Test("aiProviderId extracts provider id from section key")
	func aiProviderIdFromSectionKey() {
		#expect(ConfigureStore.aiProviderId(fromSectionKey: "ai.vercel") == "vercel")
		#expect(ConfigureStore.aiProviderId(fromSectionKey: "ai.openai") == "openai")
		#expect(ConfigureStore.aiProviderId(fromSectionKey: "ai") == nil)
		#expect(ConfigureStore.aiProviderId(fromSectionKey: "gmail") == nil)
	}

	@Test("isAIProviderConfigured reads store map")
	func isAIProviderConfiguredReadsMap() {
		let store = ConfigureStore()
		store.aiProviderConfigured = ["vercel": true, "openai": false]
		#expect(store.isAIProviderConfigured(sectionKey: "ai.vercel") == true)
		#expect(store.isAIProviderConfigured(sectionKey: "ai.openai") == false)
		#expect(store.isAIProviderConfigured(sectionKey: "ai.chutes") == nil)
	}

	@Test("AI provider detail shows Connected and ready when configured")
	func detailShowsConnectedAndReady() throws {
		let store = ConfigureStore()
		store.aiProviderConfigured = ["vercel": true]
		let view = ConfigureSectionDetailView(store: store, section: aiProviderSection())
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "ai-provider-status-connected")
		}
		#expect(throws: Never.self) { try view.inspect().find(text: "Connected and ready") }
	}

	@Test("AI provider detail shows Not connected when unconfigured")
	func detailShowsNotConnected() throws {
		let store = ConfigureStore()
		store.aiProviderConfigured = ["vercel": false]
		let view = ConfigureSectionDetailView(store: store, section: aiProviderSection())
		#expect(throws: Never.self) {
			try view.inspect().find(
				viewWithAccessibilityIdentifier: "ai-provider-status-not-connected"
			)
		}
		#expect(throws: Never.self) { try view.inspect().find(text: "Not connected") }
	}
}
