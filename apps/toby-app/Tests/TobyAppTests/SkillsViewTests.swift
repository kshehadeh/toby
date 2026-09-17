import AppKit
import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
private final class MockSkillsClient: SkillsClient {
	var skills: [SkillListItem] = []
	var details: [String: SkillDetail] = [:]
	var delays: [String: Duration] = [:]

	func listSkills() async throws -> [SkillListItem] {
		skills
	}

	func fetchSkill(dirName: String) async throws -> SkillDetail {
		if let delay = delays[dirName] {
			try await Task.sleep(for: delay)
		}
		guard let detail = details[dirName] else {
			throw TobyClientError.serverError("Missing mock skill \(dirName)")
		}
		return detail
	}

	func runConfigureAction(
		_ action: String,
		body: [String: String]
	) async throws -> ConfigureActionResponse {
		ConfigureActionResponse(
			ok: true,
			personaName: nil,
			scheduleId: nil,
			runId: nil,
			dirName: nil
		)
	}
}

@MainActor
@Suite("SkillsView")
struct SkillsViewTests {
	private func detail(_ id: String) -> SkillDetail {
		SkillDetail(
			dirName: id,
			name: id.capitalized,
			summary: "\(id) summary",
			bodyMarkdown: "# \(id)",
			tools: nil,
			integrations: nil
		)
	}

	@Test("skills view renders detail content")
	func skillsViewRendersDetailContent() throws {
		let view = SkillsView(store: SkillsStore())
		#expect(throws: Never.self) { try view.inspect().find(SkillsDetailView.self) }
	}

	@Test("empty skills state shows skill overview and create action")
	func emptySkillsStateShowsCreateAction() throws {
		let store = SkillsStore()
		let view = SkillsDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "feature-browser-placeholder")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "empty-create-skill-button")
		}
	}

	@Test("skills sidebar shows skill names")
	func skillsSidebarShowsSkillNames() throws {
		let store = SkillsStore()
		store.skills = [
			SkillListItem(dirName: "skill-1", name: "Research", summary: "Research assistant"),
			SkillListItem(dirName: "skill-2", name: "Planner", summary: "Planning helper"),
		]
		let view = SkillsSidebarView(store: store, onDelete: { _ in })
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Research")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Planner")
		}
	}

	@Test("unselected skills show a placeholder")
	func unselectedSkillsShowCards() throws {
		let store = SkillsStore()
		store.skills = [
			SkillListItem(
				dirName: "research",
				name: "Research",
				summary: "Gather and synthesize information."
			),
			SkillListItem(
				dirName: "planner",
				name: "Planner",
				summary: "Planning helper",
				enabled: false
			),
		]
		let view = SkillsDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "feature-browser-placeholder")
		}
		let list = SkillsSidebarView(store: store, onDelete: { _ in })
		#expect(throws: Never.self) {
			try list.inspect().find(text: "Research")
		}
		#expect(throws: Never.self) {
			try list.inspect().find(text: "Planner")
		}
	}

	@Test("skills sidebar omits the redundant overview button")
	func skillsSidebarOmitsOverviewButton() throws {
		let store = SkillsStore()
		let view = SkillsSidebarView(store: store, onDelete: { _ in })
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "skills-home-button")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "New Skill")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "create-skill-button")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "Add Skill")
		}
	}

	@Test("skills sidebar renders rows when no skill is selected")
	func skillsSidebarRendersRowsWhenNoSkillIsSelected() throws {
		let store = SkillsStore()
		store.skills = [
			SkillListItem(dirName: "research", name: "Research", summary: "Research assistant"),
		]
		let view = SkillsSidebarView(store: store, onDelete: { _ in })
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "skill-sidebar-row-research")
		}
	}

	@Test("skills sidebar highlights the selected skill")
	func skillsSidebarHighlightsSelectedSkill() throws {
		let store = SkillsStore()
		let skill = SkillListItem(dirName: "research", name: "Research", summary: "Research assistant")
		store.skills = [skill]
		store.selectedSkillId = skill.id
		let view = SkillsSidebarView(store: store, onDelete: { _ in })
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "skill-sidebar-row-\(skill.id)")
		}
		#expect(throws: Never.self) {
			try SkillSidebarRow(skill: skill, isSelected: true)
				.inspect()
				.find(viewWithAccessibilityIdentifier: "skill-sidebar-row-\(skill.id)")
		}
	}

	@Test("select home clears the selected skill")
	func selectHomeClearsSelection() {
		let store = SkillsStore()
		store.selectedSkillId = "research"
		store.selectedSkill = SkillDetail(
			dirName: "research",
			name: "Research",
			summary: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		store.selectHome()
		#expect(store.selectedSkillId == nil)
		#expect(store.selectedSkill == nil)
		#expect(store.detailEpoch == 1)
	}

	@Test("selectSkill is a no-op when the skill is already selected")
	func selectSkillNoOpWhenAlreadySelected() {
		let store = SkillsStore()
		store.selectedSkillId = "research"
		store.selectedSkill = SkillDetail(
			dirName: "research",
			name: "Research",
			summary: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		let epoch = store.detailEpoch
		store.selectSkill(id: "research")
		#expect(store.selectedSkillId == "research")
		#expect(store.selectedSkill?.id == "research")
		#expect(store.detailEpoch == epoch)
	}

	@Test("deselect cancels a pending skill selection before it can return")
	func deselectCancelsPendingSkillSelection() async {
		let client = MockSkillsClient()
		client.details["research"] = detail("research")
		client.delays["research"] = .milliseconds(50)
		let store = SkillsStore(client: client)
		store.selectSkill(id: "research")
		#expect(store.selectedSkillId == "research")
		#expect(store.isDetailLoading)

		store.selectHome()
		await Task.yield()

		#expect(store.selectedSkillId == nil)
		#expect(store.selectedSkill == nil)
		#expect(!store.isDetailLoading)
		#expect(store.detailEpoch == 2)
	}

	@Test("latest rapid selection wins an out-of-order detail load")
	func latestRapidSelectionWins() async throws {
		let client = MockSkillsClient()
		client.details = [
			"slow": detail("slow"),
			"fast": detail("fast"),
		]
		client.delays = [
			"slow": .milliseconds(80),
			"fast": .milliseconds(5),
		]
		let store = SkillsStore(client: client)

		store.selectSkill(id: "slow")
		await Task.yield()
		store.selectSkill(id: "fast")
		for _ in 0..<100 where store.selectedSkill?.id != "fast" {
			try await Task.sleep(for: .milliseconds(10))
		}

		#expect(store.selectedSkillId == "fast")
		#expect(store.selectedSkill?.id == "fast")
		#expect(!store.isDetailLoading)
	}

	@Test("skill detail shows loading while a selection fetch is in flight")
	func skillDetailShowsLoadingWhileFetching() throws {
		let store = SkillsStore()
		store.skills = [
			SkillListItem(dirName: "research", name: "Research", summary: "Research assistant"),
		]
		store.selectedSkillId = "research"
		store.selectedSkill = nil
		store.isDetailLoading = true
		let view = SkillsDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Loading skill…")
		}
	}

	@Test("skill detail does not stick on loading after a failed fetch")
	func skillDetailDoesNotStickOnLoadingAfterFailedFetch() throws {
		let store = SkillsStore()
		store.skills = [
			SkillListItem(dirName: "research", name: "Research", summary: "Research assistant"),
		]
		store.selectedSkillId = "research"
		store.selectedSkill = nil
		store.isDetailLoading = false
		store.errorMessage = "The network connection was lost."
		let view = SkillsDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Skill unavailable")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "Loading skill…")
		}
	}

	@Test("markdown text view reports a finite size for unbounded proposals")
	func markdownTextViewSizeThatFitsIsFinite() {
		#expect(SkillMarkdownTextView.fallbackHeight.isFinite)
		#expect(SkillMarkdownTextView.fallbackHeight > 0)
	}

	@Test("markdown editor repeatedly mounts a long skill body")
	func markdownEditorRepeatedlyMountsLongBody() {
		let body = String(repeating: "# Heading\n\nLong skill instruction text.\n\n", count: 400)
		let binding = Binding(get: { body }, set: { _ in })

		for _ in 0..<12 {
			let host = NSHostingView(
				rootView: SkillMarkdownTextView(
					text: binding,
					model: SkillMarkdownEditorModel()
				)
				.frame(width: 620, height: SkillMarkdownTextView.fallbackHeight)
			)
			host.frame = NSRect(
				x: 0,
				y: 0,
				width: 620,
				height: SkillMarkdownTextView.fallbackHeight
			)
			host.layoutSubtreeIfNeeded()
			#expect(host.fittingSize.width.isFinite)
			#expect(host.fittingSize.height.isFinite)
		}
	}

	@Test("skills sidebar empty-area tap clears selection")
	func skillsSidebarEmptyAreaTapClearsSelection() throws {
		let store = SkillsStore()
		store.skills = [
			SkillListItem(dirName: "research", name: "Research", summary: "Research assistant"),
		]
		store.selectedSkillId = "research"
		let view = SkillsSidebarView(store: store, onDelete: { _ in })
		let target = try view.inspect().find(
			viewWithAccessibilityIdentifier: "feature-browser-list-deselect"
		)
		try target.button().tap()
		#expect(store.selectedSkillId == nil)
	}

	@Test("skill detail shows selected skill name and summary")
	func skillDetailShowsSelectedSkill() throws {
		let store = SkillsStore()
		store.skills = [SkillListItem(dirName: "skill-1", name: "Research", summary: "Research assistant")]
		store.selectedSkillId = "skill-1"
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			summary: "Research assistant",
			bodyMarkdown: "# Research\n\nUse this skill for deep research.",
			tools: nil,
			integrations: nil
		)
		store.selectedDetailTab = .about
		let pane = aboutPane(store: store)
		#expect(throws: Never.self) {
			try pane.inspect().find(viewWithAccessibilityIdentifier: "skill-detail-name")
		}
		#expect(throws: Never.self) {
			try pane.inspect().find(text: "Research")
		}
		#expect(throws: Never.self) {
			try pane.inspect().find(text: "Summary")
		}
		#expect(throws: (any Error).self) {
			try pane.inspect().find(viewWithAccessibilityIdentifier: "skill-title-field")
		}
		#expect(throws: (any Error).self) {
			try pane.inspect().find(text: "Description")
		}
	}

	@Test("markdown body is shown as read-only instructions")
	func markdownInstructionsAreReadOnly() throws {
		let store = SkillsStore()
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			summary: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		let pane = instructionsPane(store: store)
		#expect(throws: Never.self) {
			try pane.inspect().find(text: "Sent to the model when this skill runs")
		}
		#expect(throws: (any Error).self) {
			try pane.inspect().find(text: "Write")
		}
	}

	@Test("markdown editor maps command-key shortcuts to bold and italic")
	func markdownEditorMapsCommandKeyShortcuts() {
		#expect(SkillMarkdownNSTextView.format(forCommandKey: "b") == .bold)
		#expect(SkillMarkdownNSTextView.format(forCommandKey: "B") == .bold)
		#expect(SkillMarkdownNSTextView.format(forCommandKey: "i") == .italic)
		#expect(SkillMarkdownNSTextView.format(forCommandKey: "I") == .italic)
		#expect(SkillMarkdownNSTextView.format(forCommandKey: "u") == nil)
	}

	@Test("markdown editor uses the system fixed-pitch font")
	func markdownEditorUsesSystemFixedPitchFont() {
		#expect(SkillMarkdownTextView.editorFont.isFixedPitch)
	}

	@Test("skill detail shows about and instructions tabs")
	func skillDetailShowsAboutAndInstructionsTabs() throws {
		let store = SkillsStore()
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			summary: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		#expect(store.selectedDetailTab == .about)
		let view = SkillDetailContent(store: store, skill: store.selectedSkill!)
		#expect(throws: Never.self) {
			try view.inspect().tabView()
		}
		#expect(throws: Never.self) {
			try aboutPane(store: store).inspect().find(text: "Research assistant")
		}
		#expect(throws: Never.self) {
			try aboutPane(store: store).inspect().find(text: "Summary")
		}
		#expect(throws: (any Error).self) {
			try aboutPane(store: store).inspect().find(text: "Used to display and choose this skill")
		}

		store.selectedDetailTab = .instructions
		#expect(store.selectedDetailTab == .instructions)
		#expect(throws: Never.self) {
			try instructionsPane(store: store).inspect().find(
				text: "Sent to the model when this skill runs"
			)
		}
	}

	@Test("selecting a skill resets the detail tab to about")
	func selectingSkillResetsDetailTab() {
		let store = SkillsStore()
		store.selectedSkillId = "research"
		store.selectedSkill = SkillDetail(
			dirName: "research",
			name: "Research",
			summary: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		store.selectedDetailTab = .instructions
		store.selectSkill(id: "other")
		#expect(store.selectedDetailTab == .about)
	}

	@Test("skill editor edits the icon, not the about tab")
	func skillEditorEditsIcon() throws {
		let store = SkillsStore()
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			summary: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		store.startEdit()
		var iconPickerPresented = false
		let pane = SkillEditorAboutPane(
			store: store,
			isIconPickerPresented: Binding(
				get: { iconPickerPresented },
				set: { iconPickerPresented = $0 }
			)
		)
		#expect(throws: Never.self) {
			try pane.inspect().find(viewWithAccessibilityIdentifier: "skill-icon-edit-button")
		}
		let inspectPane = aboutPane(store: store)
		#expect(throws: (any Error).self) {
			try inspectPane.inspect().find(viewWithAccessibilityIdentifier: "skill-icon-edit-button")
		}
	}

	@Test("skill detail shows enabled status in the about tab")
	func skillDetailShowsEnabledStatus() throws {
		let store = SkillsStore()
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			summary: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		store.selectedDetailTab = .about
		let pane = aboutPane(store: store)
		#expect(throws: Never.self) { try pane.inspect().find(text: "Enabled") }
		#expect(throws: Never.self) { try pane.inspect().find(text: "Offered to the model") }
		#expect(throws: (any Error).self) {
			try pane.inspect().find(ViewType.Toggle.self)
		}
	}

	@Test("store exposes summary and enabled field values")
	func storeExposesSummaryAndEnabled() {
		let store = SkillsStore()
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			summary: "Deep research helper",
			enabled: false,
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		#expect(store.value(for: "skill-1.summary") == "Deep research helper")
		#expect(store.value(for: "skill-1.enabled") == "false")
	}

	@Test("store key helper builds field keys")
	func storeKeyHelperBuildsFieldKeys() {
		let store = SkillsStore()
		#expect(store.key(for: "my-skill", field: .name) == "my-skill.name")
		#expect(store.key(for: "my-skill", field: .body) == "my-skill.body")
	}

	@Test("store value returns selected skill field values")
	func storeValueReturnsSelectedSkillFields() {
		let store = SkillsStore()
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			summary: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		#expect(store.value(for: "skill-1.name") == "Research")
		#expect(store.value(for: "skill-1.summary") == "Research assistant")
		#expect(store.value(for: "skill-1.body") == "# Research")
	}

	@Test("skill models decode description as a compatibility summary")
	func skillModelsDecodeLegacyDescription() throws {
		let json = Data(
			"""
			{
			  "dirName": "research",
			  "name": "Research",
			  "description": "Research assistant",
			  "bodyMarkdown": "# Research"
			}
			""".utf8
		)
		let skill = try JSONDecoder().decode(SkillDetail.self, from: json)
		#expect(skill.summary == "Research assistant")
	}

	@Test("mutating skill tools set covers write paths")
	func mutatingSkillToolsCoverWritePaths() {
		#expect(SkillsStore.mutatingSkillTools.contains("createLocalSkill"))
		#expect(!SkillsStore.mutatingSkillTools.contains("loadLocalSkills"))
		#expect(!SkillsStore.mutatingSkillTools.contains("writeTextFile"))
	}

	@Test("skills notification name is defined")
	func skillsNotificationNameIsDefined() {
		#expect(Notification.Name.skillsDidChange.rawValue == "toby.skillsDidChange")
	}

	@Test("handleExternalSkillChange marks store dirty when not yet loaded")
	func handleExternalSkillChangeMarksDirtyWhenNotLoaded() {
		let store = SkillsStore()
		#expect(store.hasLoadedOnce == false)
		#expect(store.isDirty == false)
		store.handleExternalSkillChange()
		#expect(store.isDirty == true)
	}

	@Test("markDirty sets isDirty for ensure paths")
	func markDirtySetsIsDirty() {
		let store = SkillsStore()
		store.hasLoadedOnce = true
		#expect(store.isDirty == false)
		store.markDirty()
		#expect(store.isDirty == true)
	}

	@Test("startCreate opens a draft without adding a skill")
	func startCreateDoesNotAddSkillUntilSave() throws {
		let store = SkillsStore()
		store.startCreate()
		#expect(store.skills.isEmpty)
		#expect(store.editor?.isNew == true)
		#expect(store.isEditorDirty == false)
		var draft = store.editor!
		draft.name = "Research helper"
		store.editor = draft
		#expect(store.isEditorDirty == true)
		store.cancelEditor()
		#expect(store.editor == nil)
		#expect(store.skills.isEmpty)

		store.startCreate()
		var iconPickerPresented = false
		let pane = SkillEditorAboutPane(
			store: store,
			isIconPickerPresented: Binding(
				get: { iconPickerPresented },
				set: { iconPickerPresented = $0 }
			)
		)
		#expect(throws: Never.self) {
			try pane.inspect().find(viewWithAccessibilityIdentifier: "skill-title-field")
		}
		#expect(throws: Never.self) {
			try SkillEditorSheet(store: store).inspect().find(
				viewWithAccessibilityIdentifier: "skill-editor-sheet"
			)
		}
		#expect(throws: Never.self) {
			try SkillEditorSheet(store: store).inspect().find(
				viewWithAccessibilityIdentifier: "skill-editor-tabs"
			)
		}
	}
}

@MainActor
private func aboutPane(store: SkillsStore) -> SkillAboutPane {
	SkillAboutPane(skill: store.selectedSkill!)
}

@MainActor
private func instructionsPane(store: SkillsStore) -> SkillInstructionsPane {
	SkillInstructionsPane(skill: store.selectedSkill!)
}
