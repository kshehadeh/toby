import Foundation
import Observation

struct SkillListItem: Decodable, Identifiable {
	let dirName: String
	let name: String
	let description: String?

	var id: String { dirName }
}

struct SkillDetail: Decodable, Identifiable {
	let dirName: String
	let name: String
	let description: String
	let bodyMarkdown: String
	let tools: [String]?
	let integrations: [String]?

	var id: String { dirName }
}

enum SkillField: String {
	case name = "name"
	case description = "description"
	case body = "body"
}

@Observable
@MainActor
final class SkillsStore {
	var skills: [SkillListItem] = []
	var selectedSkillId: String?
	var selectedSkill: SkillDetail?
	var isListLoading = false
	var isDetailLoading = false
	var isSaving = false
	var errorMessage: String?
	var pendingDelete: PendingDelete?

	struct PendingDelete {
		let dirName: String
		let name: String
	}

	private let client = TobyClient()
	private var autosaveTask: Task<Void, Never>?
	private let autosaveDelay: Duration = .milliseconds(450)
	private var draft: [String: String] = [:]

	func load() async {
		isListLoading = true
		errorMessage = nil
		defer { isListLoading = false }
		do {
			skills = try await client.listSkills()
			if selectedSkillId == nil || !skills.contains(where: { $0.id == selectedSkillId }) {
				selectedSkillId = skills.first?.id
			}
			if let selectedSkillId {
				await loadDetail(id: selectedSkillId)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectSkill(id: String) async {
		await flushPendingSave()
		selectedSkillId = id
		await loadDetail(id: id)
	}

	func createSkill() async {
		await flushPendingSave()
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			let result = try await client.runConfigureAction("create-skill", body: [:])
			skills = try await client.listSkills()
			if let newId = result.dirName {
				selectedSkillId = newId
				await loadDetail(id: newId)
			} else if let first = skills.first {
				selectedSkillId = first.id
				await loadDetail(id: first.id)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func deleteSkill(id: String) async {
		await flushPendingSave()
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			_ = try await client.runConfigureAction(
				"delete-skill",
				body: ["dirName": id],
			)
			skills = try await client.listSkills()
			if selectedSkillId == id {
				selectedSkillId = skills.first?.id
				if let selectedSkillId {
					await loadDetail(id: selectedSkillId)
				} else {
					selectedSkill = nil
				}
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func value(for key: String) -> String {
		if let draftValue = draft[key] {
			return draftValue
		}
		guard let skill = selectedSkill else { return "" }
		let parts = key.split(separator: ".", maxSplits: 1)
		guard parts.count == 2, String(parts[0]) == skill.dirName else { return "" }
		let field = String(parts[1])
		switch SkillField(rawValue: field) {
		case .name: return skill.name
		case .description: return skill.description
		case .body: return skill.bodyMarkdown
		default: return ""
		}
	}

	func setDraftValue(_ key: String, _ value: String) {
		let saved = self.value(forSavedKey: key)
		if value == saved {
			draft.removeValue(forKey: key)
		} else {
			draft[key] = value
		}
		scheduleAutosave()
	}

	func flushPendingSave() async {
		autosaveTask?.cancel()
		autosaveTask = nil
		await savePendingChanges()
	}

	private func loadDetail(id: String) async {
		isDetailLoading = true
		errorMessage = nil
		defer { isDetailLoading = false }
		do {
			selectedSkill = try await client.fetchSkill(dirName: id)
			pruneDraft()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	private func pruneDraft() {
		guard let skill = selectedSkill else {
			draft = [:]
			return
		}
		for key in draft.keys {
			let saved = value(forSavedKey: key, skill: skill)
			if draft[key] == saved {
				draft.removeValue(forKey: key)
			}
		}
	}

	private func value(forSavedKey key: String, skill: SkillDetail? = nil) -> String {
		let target = skill ?? selectedSkill
		guard let target else { return "" }
		let parts = key.split(separator: ".", maxSplits: 1)
		guard parts.count == 2, String(parts[0]) == target.dirName else { return "" }
		let field = String(parts[1])
		switch SkillField(rawValue: field) {
		case .name: return target.name
		case .description: return target.description
		case .body: return target.bodyMarkdown
		default: return ""
		}
	}

	private func scheduleAutosave() {
		autosaveTask?.cancel()
		guard hasPendingChanges else {
			autosaveTask = nil
			return
		}
		autosaveTask = Task { [weak self, autosaveDelay] in
			do {
				try await Task.sleep(for: autosaveDelay)
			} catch {
				return
			}
			await self?.runAutosaveTask()
		}
	}

	private func runAutosaveTask() async {
		autosaveTask = nil
		await savePendingChanges()
	}

	private var hasPendingChanges: Bool {
		!allPendingChanges.isEmpty
	}

	private var allPendingChanges: [String: String] {
		var changes: [String: String] = [:]
		for (key, draftValue) in draft {
			let saved = self.value(forSavedKey: key)
			if draftValue != saved {
				changes[key] = draftValue
			}
		}
		return changes
	}

	private func savePendingChanges() async {
		if isSaving {
			scheduleAutosave()
			return
		}
		let changes = allPendingChanges
		guard !changes.isEmpty else { return }
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			var nameChanged = false
			for (key, value) in changes {
				let parts = key.split(separator: ".", maxSplits: 1)
				guard parts.count == 2 else { continue }
				let dirName = String(parts[0])
				let field = String(parts[1])
				if field == SkillField.body.rawValue {
					_ = try await client.runConfigureAction(
						"update-skill-body",
						body: ["dirName": dirName, "body": value],
					)
				} else {
					_ = try await client.runConfigureAction(
						"update-skill-field",
						body: ["dirName": dirName, "field": field, "value": value],
					)
					if field == SkillField.name.rawValue {
						nameChanged = true
					}
				}
			}
			if nameChanged, let selectedSkillId {
				skills = try await client.listSkills()
				await loadDetail(id: selectedSkillId)
			} else if let selectedSkillId {
				await loadDetail(id: selectedSkillId)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}
