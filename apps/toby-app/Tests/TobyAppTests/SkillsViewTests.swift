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

	@Test("skill detail shows selected skill name and description")
	func skillDetailShowsSelectedSkill() throws {
		let store = SkillsStore()
		store.skills = [SkillListItem(dirName: "skill-1", name: "Research", description: "Research assistant")]
		store.selectedSkillId = "skill-1"
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			description: "Research assistant",
			summary: "Helps with research",
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
			summary: "",
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

	@Test("delete button is accessible when a skill is selected")
	func deleteButtonVisibleWhenSkillSelected() throws {
		let store = SkillsStore()
		store.selectedSkill = SkillDetail(
			dirName: "skill-1",
			name: "Research",
			description: "Research assistant",
			summary: "",
			bodyMarkdown: "",
			tools: nil,
			integrations: nil
		)
		let view = SkillsView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "delete-skill-button")
		}
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
			summary: "Helps with research",
			bodyMarkdown: "# Research",
			tools: nil,
			integrations: nil
		)
		#expect(store.value(for: "skill-1.name") == "Research")
		#expect(store.value(for: "skill-1.description") == "Research assistant")
		#expect(store.value(for: "skill-1.summary") == "Helps with research")
		#expect(store.value(for: "skill-1.body") == "# Research")
	}
}
