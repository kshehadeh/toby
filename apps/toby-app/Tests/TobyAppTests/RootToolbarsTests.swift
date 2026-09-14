import Foundation
import SwiftUI
import Testing
import ViewInspector
@testable import TobyApp

@MainActor
@Suite("RootToolbars")
struct RootToolbarsTests {
	@Test("Unselected routes have a header", arguments: DetailRoute.allCases)
	func sectionHeader(route: DetailRoute) {
		#expect(RootToolbars.routeTitle(route) == route.menuTitle)
		#expect(RootToolbars.routeTitle(route, selectedItemName: " \n ") == route.menuTitle)
	}

	@Test("Selected item names replace section headers", arguments: DetailRoute.allCases.filter { $0 != .dashboard })
	func selectedItemHeader(route: DetailRoute) {
		#expect(RootToolbars.routeTitle(route, selectedItemName: " Weekly briefing ") == "Weekly briefing")
	}

	@Test("Recording multiselection uses a count instead of an individual title")
	func recordingSelectionHeader() {
		#expect(RootToolbars.routeTitle(.recordings, selectedItemName: "Meeting", selectedCount: 1) == "Meeting")
		#expect(RootToolbars.routeTitle(.recordings, selectedItemName: "Meeting", selectedCount: 3) == "3 recordings")
	}

	@Test("Recording window title matches the list title")
	func recordingWindowTitleMatchesListTitle() {
		let named = ListenRecordingSummary(
			id: "r1",
			dir: "/tmp/r1",
			name: "Weekly standup",
			description: nil,
			createdAt: "2026-06-22T10:00:00Z",
			startedAt: "2026-06-22T10:00:00Z",
			stoppedAt: nil,
			durationMs: 60000,
			sources: ListenSourceSelection(mic: true, system: false),
			hasAudio: true,
			hasTranscript: true,
			hasSummary: false
		)
		#expect(
			RootToolbars.recordingsNavigationTitle(recording: named, selectedCount: 1)
				== "Weekly standup"
		)
		#expect(named.displayName == "Weekly standup")
		#expect(recordingSidebarTitle(named) == "Weekly standup")

		let unnamed = ListenRecordingSummary(
			id: "r2",
			dir: "/tmp/r2",
			name: nil,
			description: nil,
			createdAt: "2026-06-22T10:00:00Z",
			startedAt: "2026-06-22T10:00:00Z",
			stoppedAt: nil,
			durationMs: 60000,
			sources: ListenSourceSelection(mic: true, system: false),
			hasAudio: true,
			hasTranscript: false,
			hasSummary: false
		)
		let expectedDate = friendlyRecordingDate("2026-06-22T10:00:00Z", fallback: "2026-06-22T10:00:00Z")
		#expect(
			RootToolbars.recordingsNavigationTitle(recording: unnamed, selectedCount: 1)
				== expectedDate
		)
		#expect(unnamed.displayName == expectedDate)
		#expect(recordingSidebarTitle(unnamed) == expectedDate)
		#expect(
			RootToolbars.recordingsNavigationTitle(recording: named, selectedCount: 0)
				== "Recordings"
		)
	}

	@Test("Schedule subtitle reflects enabled state and next run")
	func scheduleWindowSubtitle() {
		#expect(
			RootToolbars.schedulesNavigationSubtitle(isEnabled: true, nextRunText: "in 5 minutes")
				== "Next run in 5 minutes"
		)
		#expect(
			RootToolbars.schedulesNavigationSubtitle(isEnabled: true, nextRunText: nil)
				== "No upcoming run"
		)
		#expect(
			RootToolbars.schedulesNavigationSubtitle(isEnabled: false, nextRunText: "in 5 minutes")
				== "Paused"
		)
	}

	@Test("Skill subtitle uses enabled state and edit date")
	func skillWindowSubtitle() {
		#expect(
			RootToolbars.skillsNavigationSubtitle(
				isEnabled: true,
				updatedAt: nil,
				createdAt: nil
			) == "Enabled"
		)
		#expect(
			RootToolbars.skillsNavigationSubtitle(
				isEnabled: false,
				updatedAt: nil,
				createdAt: nil
			) == "Disabled"
		)
		let edited = RootToolbars.skillsNavigationSubtitle(
			isEnabled: true,
			updatedAt: "2026-06-22T10:00:00Z",
			createdAt: "2026-06-01T10:00:00Z"
		)
		#expect(edited.hasPrefix("Enabled · Edited "))
	}

	@Test("Project subtitle is the meta line unless a project chat is open")
	func projectWindowSubtitle() {
		let project = ProjectSummary(
			id: "proj-1",
			slug: "proj-1",
			name: "Demo",
			summary: "",
			folderPath: "/tmp/proj-1",
			personaName: "toby",
			outputsDir: nil,
			skillsDir: nil,
			createdAt: nil,
			updatedAt: nil
		)
		let options = [
			PersonaOption(
				name: "toby",
				label: "Toby",
				imagePath: nil,
				imageUrl: nil,
				isDefault: true,
				isBuiltIn: true
			),
		]
		#expect(
			RootToolbars.projectsNavigationSubtitle(
				project: project,
				isShowingChat: false,
				chatActivityLine: "Thinking…",
				chatCount: 3,
				personaOptions: options
			) == "3 chats · Toby"
		)
		#expect(
			RootToolbars.projectsNavigationSubtitle(
				project: project,
				isShowingChat: true,
				chatActivityLine: "Thinking…",
				chatCount: 3,
				personaOptions: options
			) == "Thinking…"
		)
		#expect(
			RootToolbars.projectsNavigationSubtitle(
				project: nil,
				isShowingChat: false,
				chatActivityLine: "",
				chatCount: 0,
				personaOptions: options
			).isEmpty
		)
	}

	@Test("Flow editor title uses the draft name and New/Edit subtitle")
	func flowEditorWindowTitleAndSubtitle() {
		var draft = FlowEditorDraft.blank()
		#expect(
			RootToolbars.flowsNavigationTitle(selectedName: nil, editor: draft)
				== "Untitled flow"
		)
		#expect(
			RootToolbars.flowsNavigationSubtitle(nil, editor: draft)
				== "New flow"
		)
		draft.existingId = "flow.custom"
		draft.name = "Focus mode"
		#expect(
			RootToolbars.flowsNavigationTitle(selectedName: "Old name", editor: draft)
				== "Focus mode"
		)
		#expect(
			RootToolbars.flowsNavigationSubtitle(nil, editor: draft)
				== "Edit flow"
		)
	}

	@Test("Flow subtitle is the flow id")
	func flowWindowSubtitle() {
		let flow = FlowListItem(
			id: "dashboard.email.summary",
			name: "dashboard.email.summary",
			description: "Fetch unread",
			icon: nil,
			builtin: true,
			persona: nil,
			nodes: [],
			result: nil,
			destinations: nil,
			createdAt: nil,
			updatedAt: nil
		)
		#expect(RootToolbars.flowsNavigationSubtitle(flow) == "dashboard.email.summary")
		#expect(RootToolbars.flowsNavigationSubtitle(nil).isEmpty)
	}

	@Test("Untitled recording keeps the date as subtitle and an empty editable name")
	func untitledRecordingEditableNameIsEmpty() {
		let unnamed = ListenRecordingSummary(
			id: "r2",
			dir: "/tmp/r2",
			name: nil,
			description: nil,
			createdAt: "2026-09-04T12:00:00Z",
			startedAt: "2026-09-04T12:00:00Z",
			stoppedAt: nil,
			durationMs: 60000,
			sources: ListenSourceSelection(mic: true, system: false),
			hasAudio: true,
			hasTranscript: false,
			hasSummary: false
		)
		#expect(normalizedRecordingName(unnamed) == nil)
		let expectedDate = friendlyRecordingDate("2026-09-04T12:00:00Z", fallback: "2026-09-04T12:00:00Z")
		#expect(
			RootToolbars.recordingsNavigationSubtitle(recording: unnamed, selectedCount: 1)
				== expectedDate
		)
	}

	@Test("Recording window subtitle is the formatted start date")
	func recordingWindowSubtitleIsFormattedDate() {
		let recording = ListenRecordingSummary(
			id: "r1",
			dir: "/tmp/r1",
			name: "Weekly standup",
			description: nil,
			createdAt: "2026-06-22T10:00:00Z",
			startedAt: "2026-06-22T10:00:00Z",
			stoppedAt: nil,
			durationMs: 60000,
			sources: ListenSourceSelection(mic: true, system: false),
			hasAudio: true,
			hasTranscript: true,
			hasSummary: false
		)
		let expectedDate = friendlyRecordingDate("2026-06-22T10:00:00Z", fallback: "2026-06-22T10:00:00Z")
		#expect(
			RootToolbars.recordingsNavigationSubtitle(recording: recording, selectedCount: 1)
				== expectedDate
		)
		#expect(
			RootToolbars.recordingsNavigationSubtitle(recording: recording, selectedCount: 0)
				.isEmpty
		)
		#expect(
			RootToolbars.recordingsNavigationSubtitle(recording: recording, selectedCount: 3)
				.isEmpty
		)
		#expect(
			RootToolbars.recordingsNavigationSubtitle(recording: nil, selectedCount: 1)
				.isEmpty
		)
	}

	@Test("Header exposes its title and optional activity as text")
	func headerText() throws {
		let header = RootHeaderTitle(title: "Home", activityLine: "Updated 1 min ago")
		let inspected = try header.inspect().hStack()
		#expect(try inspected.find(text: "Home").accessibilityIdentifier() == "main-header-title")
		#expect(try inspected.find(text: "Updated 1 min ago").string() == "Updated 1 min ago")
		#expect(try inspected.help().string() == "Home")
		let plain = try RootHeaderTitle(title: "Skills").inspect().hStack()
		#expect(try plain.text(1).string() == "Skills")
		#expect(throws: (any Error).self) { try plain.find(text: "") }
	}

	@Test("recordingsDeleteHelp singular and plural")
	func recordingsDeleteHelp() {
		#expect(RootToolbars.recordingsDeleteHelp(selectedCount: 1) == "Delete Recording")
		#expect(RootToolbars.recordingsDeleteHelp(selectedCount: 3) == "Delete 3 Recordings")
	}

	@Test("updateHelp names the available version")
	func updateHelpNamesVersion() {
		let model = RootCommonToolbarModel(
			isRecordingActive: false,
			isRecordButtonDisabled: false,
			canGoBack: false,
			canGoForward: false,
			isUpdateAvailable: true,
			latestVersion: "1.2.4",
			onToggleRecording: {},
			onSearch: {},
			onOpenSettings: {},
			onBack: {},
			onForward: {}
		)
		#expect(RootToolbars.updateHelp(model: model) == "Update to v1.2.4 is available")
		var upgrading = model
		upgrading.isUpgrading = true
		#expect(RootToolbars.updateHelp(model: upgrading) == "Updating Toby")
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

	@Test("recordings transcribe and summarize toolbar labels are context aware")
	func recordingsTranscribeAndSummarizeLabels() {
		#expect(RootToolbars.recordingsTranscribeHelp(hasTranscript: false) == "Transcribe")
		#expect(RootToolbars.recordingsTranscribeHelp(hasTranscript: true) == "Re-Transcribe")
		#expect(RootToolbars.recordingsSummarizeHelp(hasSummary: false) == "Summarize")
		#expect(RootToolbars.recordingsSummarizeHelp(hasSummary: true) == "Re-Summarize")
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
