import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("ProjectsView")
struct ProjectsViewTests {
	@Test("first paragraph helper returns empty for blank text")
	func firstParagraphEmpty() {
		#expect(projectSummaryFirstParagraph("") == "")
		#expect(projectSummaryFirstParagraph("   \n\n  ") == "")
	}

	@Test("first paragraph helper returns whole text when single paragraph")
	func firstParagraphSingle() {
		#expect(projectSummaryFirstParagraph("Just one paragraph.") == "Just one paragraph.")
		#expect(
			projectSummaryFirstParagraph("Line one\nstill same paragraph")
				== "Line one\nstill same paragraph"
		)
	}

	@Test("first paragraph helper stops at blank line")
	func firstParagraphMulti() {
		let summary = """
		First paragraph here.

		Second paragraph should be hidden.
		"""
		#expect(projectSummaryFirstParagraph(summary) == "First paragraph here.")
	}

	@Test("first paragraph helper trims and normalizes CRLF")
	func firstParagraphCRLF() {
		let summary = "  Lead para\r\n\r\nNext para  "
		#expect(projectSummaryFirstParagraph(summary) == "Lead para")
	}

	@Test("first paragraph helper treats whitespace-only blank lines as separators")
	func firstParagraphWhitespaceBlankLine() {
		let summary = "Alpha\n  \n\nBeta"
		#expect(projectSummaryFirstParagraph(summary) == "Alpha")
	}

	@Test("meta line combines chat count and persona label")
	func metaLineFormatting() {
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
		#expect(projectChatCountLabel(0) == "0 chats")
		#expect(projectChatCountLabel(1) == "1 chat")
		#expect(projectChatCountLabel(4) == "4 chats")
		#expect(projectPersonaLabel(personaName: nil, options: options) == "Default")
		#expect(projectPersonaLabel(personaName: "toby", options: options) == "Toby")
		#expect(projectPersonaLabel(personaName: "unknown", options: options) == "unknown")
		#expect(
			projectMetaLine(chatCount: 3, personaName: "toby", options: options)
				== "3 chats · Toby"
		)
	}

	@Test("summary editor sheet shows title and save cancel")
	func summaryEditorSheetChrome() throws {
		let view = ProjectSummaryEditorSheet(
			initialSummary: "Hello",
			isSaving: false,
			onSave: { _ in },
			onCancel: {}
		)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Edit Summary")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(button: "Cancel")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-summary-save-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-summary-editor-sheet")
		}
	}

	@Test("empty projects state shows overview and create action")
	func emptyStateShowsCreateAction() throws {
		let store = ProjectsStore()
		store.hasLoadedOnce = true
		let view = ProjectsView(projectsStore: store, chatStore: ChatStore())
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "projects-empty-state")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "empty-create-project-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Create Project")
		}
	}

	@Test("projects index shows cards when none is selected")
	func indexShowsProjectCards() throws {
		let store = ProjectsStore()
		store.projects = [
			sampleProject(id: "proj-1", name: "Weekly Overview"),
			sampleProject(id: "proj-2", name: "Northstar"),
		]
		store.projectSessions = [
			"proj-1": [sampleSession(id: "s1", name: "Monday recap")],
			"proj-2": [],
		]
		let view = ProjectsIndexView(
			store: store,
			onSelect: { _ in }
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "projects-home-view")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Weekly Overview")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Northstar")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "1 chat · Default")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "0 chats · Default")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "projects-index-create-button")
		}
	}

	@Test("sidebar lists projects with meta and omits nested chats")
	func sidebarListsProjectsWithoutChats() throws {
		let store = ProjectsStore()
		store.projects = [sampleProject(name: "Demo")]
		store.projectSessions = [
			"proj-1": [sampleSession(id: "chat-hidden", name: "Hidden sidebar chat")],
		]
		store.personaOptions = [
			PersonaOption(
				name: "toby",
				label: "Toby",
				imagePath: nil,
				imageUrl: nil,
				isDefault: true,
				isBuiltIn: true
			),
		]
		store.projects[0] = sampleProject(name: "Demo", personaName: "toby")
		let view = ProjectsSidebarView(
			store: store,
			onCreate: {},
			onSelect: { _ in },
			onSelectHome: {}
		)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Demo")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "1 chat · Toby")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "projects-home-button")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "Hidden sidebar chat")
		}
	}

	@Test("project details show summary preview, new chat, and last five chats")
	func detailsShowSummaryAndRecentChats() throws {
		let store = ProjectsStore()
		let project = sampleProject(
			summary: "First paragraph for the preview.\n\nRest of the long summary."
		)
		store.hasLoadedOnce = true
		store.projects = [project]
		store.selectedProjectId = project.id
		store.selectedProject = project
		store.projectSessions = [
			project.id: (1...6).map { sampleSession(id: "chat-\($0)", name: "Chat \($0)") },
		]

		let view = ProjectsView(projectsStore: store, chatStore: ChatStore())
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-summary-edit-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-summary-preview")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "First paragraph for the preview.")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "Rest of the long summary.")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-new-chat-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Chat 1")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Chat 5")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "Chat 6")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-show-all-chats-button")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-delete-button")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(button: "Delete…")
		}
	}

	@Test("projects inspector shows empty summary placeholder")
	func inspectorShowsEmptySummaryPlaceholder() throws {
		let projectsStore = ProjectsStore()
		let project = sampleProject(summary: "")
		projectsStore.hasLoadedOnce = true
		projectsStore.projects = [project]
		projectsStore.selectedProjectId = project.id
		projectsStore.selectedProject = project

		let view = ProjectsView(projectsStore: projectsStore, chatStore: ChatStore())
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-summary-empty-placeholder")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "No summary yet")
		}
	}

	@Test("recentSessions returns at most five chats")
	func recentSessionsLimit() {
		let store = ProjectsStore()
		store.selectedProjectId = "proj-1"
		store.projectSessions = [
			"proj-1": (1...8).map { sampleSession(id: "s\($0)", name: "S\($0)") },
		]
		#expect(store.recentSessions().map(\.id) == ["s1", "s2", "s3", "s4", "s5"])
		#expect(store.recentSessions(limit: 2).map(\.id) == ["s1", "s2"])
	}

	@Test("sidebar recent chats returns the ten most recent chats for its project")
	func sidebarRecentChatsLimit() {
		let store = ProjectsStore()
		store.projectSessions = [
			"proj-1": (1...12).map { sampleSession(id: "s\($0)", name: "S\($0)") },
		]

		#expect(
			store.recentSessions(for: "proj-1", limit: 10).map(\.id)
				== (1...10).map { "s\($0)" }
		)
	}

	@Test("selectHome clears the selected project")
	func selectHomeClearsSelection() async {
		let store = ProjectsStore()
		store.selectedProjectId = "proj-1"
		store.selectedProject = sampleProject()
		store.isShowingChat = true
		await store.selectHome(flush: false)
		#expect(store.selectedProjectId == nil)
		#expect(store.selectedProject == nil)
		#expect(store.isShowingChat == false)
	}

	@Test("showProjectHome leaves chat but keeps the project selected")
	func showProjectHomeKeepsSelection() {
		let store = ProjectsStore()
		store.selectedProjectId = "proj-1"
		store.selectedProject = sampleProject()
		store.isShowingChat = true
		store.showProjectHome()
		#expect(store.selectedProjectId == "proj-1")
		#expect(store.selectedProject != nil)
		#expect(store.isShowingChat == false)
	}

	@Test("sidebar highlights the project with an open chat")
	func sidebarHighlightsActiveProjectChat() throws {
		let store = ProjectsStore()
		store.projects = [sampleProject(name: "Demo")]
		store.selectedProjectId = "proj-1"
		store.isShowingChat = true
		let view = ProjectsSidebarView(
			store: store,
			onCreate: {},
			onSelect: { _ in },
			onSelectHome: {}
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-sidebar-active-chat")
		}
	}

	@Test("project file changes distinguish additions, updates, and deletions")
	func projectFileChanges() {
		let previous = [
			treeEntry(name: "Changed.txt", path: "Changed.txt", modifiedAtMs: 1, size: 2),
			treeEntry(name: "Removed.txt", path: "Removed.txt", modifiedAtMs: 1, size: 1),
		]
		let next = [
			treeEntry(name: "Added.txt", path: "Added.txt", modifiedAtMs: 1, size: 1),
			treeEntry(name: "Changed.txt", path: "Changed.txt", modifiedAtMs: 2, size: 3),
		]

		#expect(projectTreeChanges(from: previous, to: next) == [
			ProjectTreeChange(
				entry: treeEntry(name: "Added.txt", path: "Added.txt", modifiedAtMs: 1, size: 1),
				kind: .added
			),
			ProjectTreeChange(
				entry: treeEntry(name: "Changed.txt", path: "Changed.txt", modifiedAtMs: 2, size: 3),
				kind: .updated
			),
			ProjectTreeChange(
				entry: treeEntry(name: "Removed.txt", path: "Removed.txt", modifiedAtMs: 1, size: 1),
				kind: .deleted
			),
		])
	}

	@Test("files sidebar shows changed entries and deleted items")
	func filesSidebarShowsChanges() throws {
		let store = ProjectsStore()
		store.selectedProject = sampleProject()
		store.tree = [
			treeEntry(name: "Added.txt", path: "Added.txt", modifiedAtMs: 1, size: 1),
		]
		store.treeChanges = [
			ProjectTreeChange(entry: store.tree[0], kind: .added),
			ProjectTreeChange(
				entry: treeEntry(name: "Removed.txt", path: "Removed.txt", modifiedAtMs: 1, size: 1),
				kind: .deleted
			),
		]

		let view = ProjectFilesSidebarView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-files-sidebar")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Added")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Recently deleted")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Removed.txt")
		}
	}

	@Test("project chats start with the Files sidebar open and reset it on return")
	func projectChatFilesSidebarVisibility() {
		let store = ProjectsStore()
		store.showProjectChat()
		#expect(store.isShowingChat)
		#expect(store.isFilesSidebarPresented)
		store.showProjectHome()
		#expect(store.isFilesSidebarPresented == false)
	}

	private func sampleProject(
		id: String = "proj-1",
		name: String = "Demo",
		summary: String = "",
		personaName: String? = nil
	) -> ProjectSummary {
		ProjectSummary(
			id: id,
			slug: id,
			name: name,
			summary: summary,
			folderPath: "/tmp/\(id)",
			personaName: personaName,
			outputsDir: nil,
			skillsDir: nil,
			createdAt: nil,
			updatedAt: nil
		)
	}

	private func sampleSession(id: String, name: String) -> SessionSummary {
		SessionSummary(
			id: id,
			name: name,
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z"
		)
	}

	private func treeEntry(
		name: String,
		path: String,
		modifiedAtMs: Double,
		size: Int,
		kind: String = "file",
		children: [ProjectTreeEntry]? = nil
	) -> ProjectTreeEntry {
		ProjectTreeEntry(
			name: name,
			relativePath: path,
			kind: kind,
			modifiedAtMs: modifiedAtMs,
			size: size,
			children: children
		)
	}
}
