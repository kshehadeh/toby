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

	@Test("dashboard edit toolbar labels swap with editing state")
	func dashboardEditToolbarLabels() {
		#expect(RootToolbars.dashboardEditHelp(isEditing: false) == "Edit Home")
		#expect(RootToolbars.dashboardEditHelp(isEditing: true) == "Done")
		#expect(RootToolbars.dashboardEditIdentifier(isEditing: false) == "dashboard-edit-button")
		#expect(
			RootToolbars.dashboardEditIdentifier(isEditing: true) == "dashboard-done-editing-button"
		)
	}

	@Test("dashboard actions toolbar help swaps with pane visibility")
	func dashboardActionsToolbarHelp() {
		#expect(RootToolbars.dashboardActionsHelp(actionsVisible: true) == "Hide Actions")
		#expect(RootToolbars.dashboardActionsHelp(actionsVisible: false) == "Show Actions")
	}

	@Test("projects toolbar is home, project details, or project chat")
	func projectToolbarMode() {
		#expect(
			RootToolbars.projectToolbarMode(hasSelection: false, isShowingChat: false) == .home
		)
		#expect(
			RootToolbars.projectToolbarMode(hasSelection: true, isShowingChat: false) == .project
		)
		#expect(
			RootToolbars.projectToolbarMode(hasSelection: true, isShowingChat: true) == .projectChat
		)
		#expect(
			RootToolbars.projectToolbarMode(hasSelection: false, isShowingChat: true) == .projectChat
		)
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
