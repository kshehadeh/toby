import Foundation

struct ProjectEditorDraft: Equatable, Identifiable {
	var existingId: String?
	var name: String
	var personaName: String
	var summary: String

	var id: String { existingId ?? "new" }

	var isNew: Bool { existingId == nil }

	var trimmedName: String {
		name.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	var canSave: Bool { !trimmedName.isEmpty }

	static func blank() -> ProjectEditorDraft {
		ProjectEditorDraft(
			existingId: nil,
			name: "New project",
			personaName: "",
			summary: ""
		)
	}

	static func from(project: ProjectSummary) -> ProjectEditorDraft {
		ProjectEditorDraft(
			existingId: project.id,
			name: project.name,
			personaName: project.personaName ?? "",
			summary: project.summary
		)
	}
}
