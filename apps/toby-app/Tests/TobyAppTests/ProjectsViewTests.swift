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

	@Test("projects inspector shows summary preview and edit button")
	func inspectorShowsSummaryPreview() throws {
		let projectsStore = ProjectsStore()
		let project = sampleProject(
			summary: "First paragraph for the preview.\n\nRest of the long summary."
		)
		projectsStore.projects = [project]
		projectsStore.selectedProjectId = project.id
		projectsStore.selectedProject = project

		let view = ProjectsView(projectsStore: projectsStore, chatStore: ChatStore())
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-summary-edit-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "project-summary-preview")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "First paragraph for the preview.")
		}
		// Second paragraph must not appear in the compact inspector preview.
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "Rest of the long summary.")
		}
	}

	@Test("projects inspector shows empty summary placeholder")
	func inspectorShowsEmptySummaryPlaceholder() throws {
		let projectsStore = ProjectsStore()
		let project = sampleProject(summary: "")
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

	private func sampleProject(summary: String) -> ProjectSummary {
		ProjectSummary(
			id: "proj-1",
			slug: "proj-1",
			name: "Demo",
			summary: summary,
			folderPath: "/tmp/proj-1",
			personaName: nil,
			outputsDir: nil,
			skillsDir: nil,
			createdAt: nil,
			updatedAt: nil
		)
	}
}
