import Foundation

struct SkillEditorDraft: Equatable, Identifiable {
	var existingId: String?
	var name: String
	var summary: String
	var enabled: Bool
	var bodyMarkdown: String
	var iconURL: URL?
	var hasCustomIcon: Bool
	var pendingIconData: Data?
	var pendingIconFilename: String?
	var resetIcon: Bool

	var id: String { existingId ?? "new" }

	var isNew: Bool { existingId == nil }

	var trimmedName: String {
		name.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	var canSave: Bool { !trimmedName.isEmpty }

	static func blank() -> SkillEditorDraft {
		SkillEditorDraft(
			existingId: nil,
			name: "Untitled skill",
			summary: "",
			enabled: true,
			bodyMarkdown: "",
			iconURL: nil,
			hasCustomIcon: false,
			pendingIconData: nil,
			pendingIconFilename: nil,
			resetIcon: false
		)
	}

	static func from(detail: SkillDetail) -> SkillEditorDraft {
		SkillEditorDraft(
			existingId: detail.dirName,
			name: detail.name,
			summary: detail.summary,
			enabled: detail.enabled,
			bodyMarkdown: detail.bodyMarkdown,
			iconURL: detail.resolvedIconURL,
			hasCustomIcon: detail.iconUrl != nil,
			pendingIconData: nil,
			pendingIconFilename: nil,
			resetIcon: false
		)
	}
}
