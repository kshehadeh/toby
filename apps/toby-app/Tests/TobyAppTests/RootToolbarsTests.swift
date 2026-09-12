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

	@Test("project Files toolbar help swaps with inspector visibility")
	func projectFilesToolbarHelp() {
		#expect(RootToolbars.projectFilesHelp(isPresented: true) == "Hide Files")
		#expect(RootToolbars.projectFilesHelp(isPresented: false) == "Show Files")
	}

	@Test("project Chats toolbar help swaps with inspector visibility")
	func projectChatsToolbarHelp() {
		#expect(RootToolbars.projectChatsHelp(isPresented: true) == "Hide Chats")
		#expect(RootToolbars.projectChatsHelp(isPresented: false) == "Show Chats")
	}

	@Test("integrations toolbar is none, connect, or connected")
	func integrationsToolbarMode() {
		#expect(
			RootToolbars.integrationsToolbarMode(hasSelection: false, isConnected: false) == .none
		)
		#expect(
			RootToolbars.integrationsToolbarMode(hasSelection: false, isConnected: true) == .none
		)
		#expect(
			RootToolbars.integrationsToolbarMode(hasSelection: true, isConnected: false) == .connect
		)
		#expect(
			RootToolbars.integrationsToolbarMode(hasSelection: true, isConnected: true) == .connected
		)
	}

	@Test("recordings chat toolbar is hidden, start, or show")
	func recordingsChatToolbarMode() {
		#expect(
			RootToolbars.recordingsChatToolbarMode(
				hasSingleSelection: false,
				existingChatSessionId: nil
			) == .hidden
		)
		#expect(
			RootToolbars.recordingsChatToolbarMode(
				hasSingleSelection: false,
				existingChatSessionId: "sess-1"
			) == .hidden
		)
		#expect(
			RootToolbars.recordingsChatToolbarMode(
				hasSingleSelection: true,
				existingChatSessionId: nil
			) == .startChat
		)
		#expect(
			RootToolbars.recordingsChatToolbarMode(
				hasSingleSelection: true,
				existingChatSessionId: "sess-1"
			) == .showChat
		)
	}

	@Test("recordings chat toolbar labels and identifiers")
	func recordingsChatToolbarLabels() {
		#expect(RootToolbars.recordingsChatHelp(mode: .hidden).isEmpty)
		#expect(RootToolbars.recordingsChatHelp(mode: .startChat) == "Start Chat")
		#expect(RootToolbars.recordingsChatHelp(mode: .showChat) == "Show Chat")
		#expect(RootToolbars.recordingsChatIdentifier(mode: .startChat) == "start-recording-chat-button")
		#expect(RootToolbars.recordingsChatIdentifier(mode: .showChat) == "show-recording-chat-button")
	}

	@Test("flows toolbar is home, detail, or editor")
	func flowsToolbarMode() {
		#expect(
			RootToolbars.flowsToolbarMode(hasSelection: false, isEditing: false) == .home
		)
		#expect(
			RootToolbars.flowsToolbarMode(hasSelection: true, isEditing: false) == .detail
		)
		#expect(
			RootToolbars.flowsToolbarMode(hasSelection: false, isEditing: true) == .editor
		)
		#expect(
			RootToolbars.flowsToolbarMode(hasSelection: true, isEditing: true) == .editor
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
