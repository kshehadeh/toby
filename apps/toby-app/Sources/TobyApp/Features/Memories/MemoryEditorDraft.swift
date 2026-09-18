import Foundation

struct MemoryEditorDraft: Equatable, Identifiable {
	var existingId: String?
	var type: String
	var subject: String
	var value: String
	var confidence: Double
	var sensitivity: String
	var visibility: String

	var id: String { existingId ?? "new" }

	var isNew: Bool { existingId == nil }

	var trimmedValue: String {
		value.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	var trimmedSubject: String {
		subject.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	var canSave: Bool { !trimmedValue.isEmpty }

	static func blank() -> MemoryEditorDraft {
		MemoryEditorDraft(
			existingId: nil,
			type: "fact",
			subject: "",
			value: "",
			confidence: 1,
			sensitivity: "normal",
			visibility: "usable_by_ai"
		)
	}

	static func from(memory: MemoryItem) -> MemoryEditorDraft {
		MemoryEditorDraft(
			existingId: memory.id,
			type: memory.type,
			subject: memory.subject ?? "",
			value: memory.value,
			confidence: memory.confidence,
			sensitivity: memory.sensitivity,
			visibility: memory.visibility
		)
	}
}
