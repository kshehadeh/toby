import Foundation
import Testing
@testable import TobyApp

@MainActor
@Suite("RootToolbars")
struct RootToolbarsTests {
	@Test("recordingsDeleteHelp singular and plural")
	func recordingsDeleteHelp() {
		#expect(RootToolbars.recordingsDeleteHelp(selectedCount: 1) == "Delete Recording")
		#expect(RootToolbars.recordingsDeleteHelp(selectedCount: 3) == "Delete 3 Recordings")
	}

	@Test("dashboardUpdatedText empty when never loaded")
	func dashboardUpdatedTextEmpty() {
		#expect(RootToolbars.dashboardUpdatedText(lastLoadedAt: nil).isEmpty)
	}

	@Test("dashboardUpdatedText non-empty when loaded")
	func dashboardUpdatedTextPresent() {
		let text = RootToolbars.dashboardUpdatedText(
			lastLoadedAt: Date().addingTimeInterval(-60)
		)
		#expect(text.hasPrefix("Updated "))
	}
}

@MainActor
@Suite("RootSettingsNavigation")
struct RootSettingsNavigationTests {
	@Test("client-only tab keys include appearance and personas")
	func clientOnlyTabKeys() {
		#expect(
			RootSettingsNavigation.clientOnlySettingsTabKeys.contains(
				SettingsItem.appearanceSectionKey
			)
		)
		#expect(
			RootSettingsNavigation.clientOnlySettingsTabKeys.contains(
				SettingsItem.personasSectionKey
			)
		)
	}

	@Test("prepare sets pending persona and seeds nav key outside settings mode")
	func prepareSeedsNavKey() {
		let store = ConfigureStore()
		// Settings mode is false until sections load as settings tree.
		RootSettingsNavigation.prepare(
			configureStore: store,
			navKey: "ai",
			personaName: "Toby",
		)
		#expect(store.pendingPersonaSelection == "Toby")
		#expect(store.selectedNavKey == "ai")
	}
}
