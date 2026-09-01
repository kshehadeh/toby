import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("SkillsView")
struct SkillsViewTests {
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
			try view.inspect().find(text: "Skills")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Skills are reusable instructions that teach Toby how to handle specialized work consistently across chats and automations.")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "empty-create-skill-button")
		}
	}

	@Test("skills sidebar shows skill names")
	func skillsSidebarShowsSkillNames() throws {
		let store = SkillsStore()
		store.skills = [
			SkillListItem(dirName: "skill-1", name: "Research", description: "Research assistant"),
			SkillListItem(dirName: "skill-2", name: "Planner", description: "Planning helper"),
		]
		let view = SkillsSidebarView(store: store, onDelete: { _ in })
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Research")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Planner")
		}
	}

	@Test("unselected skills show cards")
	func unselectedSkillsShowCards() throws {
		let store = SkillsStore()
		store.skills = [
			SkillListItem(
				dirName: "research",
				name: "Research",
				description: "Research assistant",
				summary: "Gather and synthesize information."
			),
			SkillListItem(
				dirName: "planner",
				name: "Planner",
				description: "Planning helper",
				enabled: false
			),
		]
		let view = SkillsDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "skills-home-view")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "skill-card-research")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Planner")
		}
	}

	@Test("skills sidebar offers the all-skills view")
	func skillsSidebarOffersHomeView() throws {
		let store = SkillsStore()
		let view = SkillsSidebarView(store: store, onDelete: { _ in })
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "skills-home-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Skills")
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

	@Test("skills sidebar marks home as selected when no skill is selected")
	func skillsSidebarMarksHomeSelected() throws {
		let store = SkillsStore()
		store.skills = [
			SkillListItem(dirName: "research", name: "Research", description: "Research assistant"),
		]
		let view = SkillsSidebarView(store: store, onDelete: { _ in })
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "skills-home-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "skill-sidebar-row-research")
		}
	}

	@Test("skills sidebar highlights the selected skill")
	func skillsSidebarHighlightsSelectedSkill() throws {
		let store = SkillsStore()
		let skill = SkillListItem(dirName: "research", name: "Research", description: "Research assistant")
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
			description: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		store.selectHome()
		#expect(store.selectedSkillId == nil)
		#expect(store.selectedSkill == nil)
	}

	@Test("skill detail shows selected skill name and description")
	func skillDetailShowsSelectedSkill() throws {
		let store = SkillsStore()
		store.skills = [SkillListItem(dirName: "skill-1", name: "Research", description: "Research assistant")]
		store.selectedSkillId = "skill-1"
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			description: "Research assistant",
			bodyMarkdown: "# Research\n\nUse this skill for deep research.",
			tools: nil,
			integrations: nil
		)
		let view = SkillsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Research")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Research assistant")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Description")
		}
	}

	@Test("markdown editor shows write mode by default")
	func markdownEditorShowsWriteModeByDefault() throws {
		let store = SkillsStore()
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			description: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		let view = SkillsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Write")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Preview")
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

	@Test("skill detail shows instructions and summary sidebar fields")
	func skillDetailShowsInstructionsAndSummary() throws {
		let store = SkillsStore()
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			description: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		let view = SkillsView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Instructions") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Summary") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Optional") }
	}

	@Test("skill detail shows enabled status pill and delete button")
	func skillDetailShowsEnabledAndDelete() throws {
		let store = SkillsStore()
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			description: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		let view = SkillsView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Enabled") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Delete Skill…") }
	}

	@Test("store exposes summary and enabled field values")
	func storeExposesSummaryAndEnabled() {
		let store = SkillsStore()
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			description: "Research assistant",
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
			description: "Research assistant",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		#expect(store.value(for: "skill-1.name") == "Research")
		#expect(store.value(for: "skill-1.description") == "Research assistant")
		#expect(store.value(for: "skill-1.body") == "# Research")
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
}
