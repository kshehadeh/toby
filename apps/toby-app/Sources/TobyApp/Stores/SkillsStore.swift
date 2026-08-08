import Foundation
import Observation

struct SkillListItem: Decodable, Identifiable {
	let dirName: String
	let name: String
	let description: String?
	var summary: String = ""
	var enabled: Bool = true
	var iconUrl: String? = nil
	var createdAt: String? = nil
	var updatedAt: String? = nil

	var id: String { dirName }
}

extension SkillListItem {
	private enum CodingKeys: String, CodingKey {
		case dirName, name, description, summary, enabled, iconUrl, createdAt, updatedAt
	}

	init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		dirName = try c.decode(String.self, forKey: .dirName)
		name = try c.decode(String.self, forKey: .name)
		description = try c.decodeIfPresent(String.self, forKey: .description)
		summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
		enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
		iconUrl = try c.decodeIfPresent(String.self, forKey: .iconUrl)
		createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
		updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
	}
}

struct SkillDetail: Decodable, Identifiable {
	let dirName: String
	let name: String
	let description: String
	var summary: String = ""
	var enabled: Bool = true
	var iconUrl: String? = nil
	var createdAt: String? = nil
	var updatedAt: String? = nil
	let bodyMarkdown: String
	let tools: [String]?
	let integrations: [String]?

	var id: String { dirName }
}

extension SkillDetail {
	private enum CodingKeys: String, CodingKey {
		case dirName, name, description, summary, enabled, iconUrl
		case createdAt, updatedAt, bodyMarkdown, tools, integrations
	}

	init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		dirName = try c.decode(String.self, forKey: .dirName)
		name = try c.decode(String.self, forKey: .name)
		description = try c.decode(String.self, forKey: .description)
		summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
		enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
		iconUrl = try c.decodeIfPresent(String.self, forKey: .iconUrl)
		createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
		updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
		bodyMarkdown = try c.decode(String.self, forKey: .bodyMarkdown)
		tools = try c.decodeIfPresent([String].self, forKey: .tools)
		integrations = try c.decodeIfPresent([String].self, forKey: .integrations)
	}
}

enum SkillField: String {
	case name = "name"
	case description = "description"
	case summary = "summary"
	case enabled = "enabled"
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
	var hasLoadedOnce = false
	var lastLoadedAt: Date?
	var errorMessage: String?
	var pendingDelete: PendingDelete?

	struct PendingDelete {
		let dirName: String
		let name: String
	}

	/// Tools that create or update local skills from chat.
	static let mutatingSkillTools: Set<String> = [
		"createLocalSkill",
	]

	/// When true, the next `ensureLoaded` / appear path should re-fetch.
	private(set) var isDirty = false

	private let client = TobyClient()
	private var autosaveTask: Task<Void, Never>?
	private let autosaveDelay: Duration = .milliseconds(450)
	private var draft: [String: String] = [:]
	private var isQuietRefreshing = false

	/// Clears skills state after a Toby home directory switch.
	func resetForHomeSwitch() {
		autosaveTask?.cancel()
		autosaveTask = nil
		skills = []
		selectedSkillId = nil
		selectedSkill = nil
		isListLoading = false
		isDetailLoading = false
		isSaving = false
		hasLoadedOnce = false
		lastLoadedAt = nil
		errorMessage = nil
		pendingDelete = nil
		isDirty = false
		draft = [:]
		isQuietRefreshing = false
	}

	func load() async {
		guard !isListLoading else { return }
		isListLoading = true
		errorMessage = nil
		defer { isListLoading = false }
		do {
			try await loadListData()
			if let selectedSkillId {
				await loadDetail(id: selectedSkillId)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func loadList() async {
		guard !isListLoading else { return }
		isListLoading = true
		errorMessage = nil
		defer { isListLoading = false }
		do {
			try await loadListData()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func ensureLoaded() async {
		if hasLoadedOnce, !isDirty {
			if let selectedSkillId, selectedSkill == nil {
				await loadDetail(id: selectedSkillId)
			}
			return
		}
		await load()
	}

	func ensureListLoaded() async {
		guard !hasLoadedOnce || isDirty else { return }
		await loadList()
	}

	/// Mark the store stale so the next load / ensure path re-fetches.
	/// Posted from chat when skill tools mutate data.
	func markDirty() {
		isDirty = true
	}

	/// Handle an external skill change (chat tools, etc.).
	/// Refreshes immediately when the store has already loaded; otherwise marks dirty
	/// for the next appear/ensure path.
	func handleExternalSkillChange() {
		markDirty()
		guard hasLoadedOnce else { return }
		Task { await refreshQuietly() }
	}

	/// Soft re-fetch without loading spinners (external invalidation while skills UI is open).
	func refreshQuietly() async {
		guard !isListLoading, !isQuietRefreshing, !isSaving else { return }
		isQuietRefreshing = true
		defer { isQuietRefreshing = false }
		do {
			try await loadListData()
			if let selectedSkillId, skills.contains(where: { $0.id == selectedSkillId }) {
				if let detail = try? await client.fetchSkill(dirName: selectedSkillId) {
					selectedSkill = detail
					pruneDraft()
				}
			} else if let selectedSkillId {
				await loadDetail(id: selectedSkillId)
			} else {
				selectedSkill = nil
			}
		} catch {
			// Quiet refresh failures are non-fatal; next explicit load retries.
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
		case .summary: return skill.summary
		case .enabled: return skill.enabled ? "true" : "false"
		case .body: return skill.bodyMarkdown
		default: return ""
		}
	}

	func setDraftValue(_ key: String, _ value: String, autosaveImmediately: Bool = false) {
		let saved = self.value(forSavedKey: key)
		if value == saved {
			draft.removeValue(forKey: key)
		} else {
			draft[key] = value
		}
		if autosaveImmediately {
			autosaveTask?.cancel()
			autosaveTask = nil
			Task { await savePendingChanges() }
		} else {
			scheduleAutosave()
		}
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

	private func loadListData() async throws {
		skills = try await client.listSkills()
		if selectedSkillId == nil || !skills.contains(where: { $0.id == selectedSkillId }) {
			selectedSkillId = skills.first?.id
		}
		hasLoadedOnce = true
		lastLoadedAt = Date()
		isDirty = false
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
		case .summary: return target.summary
		case .enabled: return target.enabled ? "true" : "false"
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
			var listChanged = false
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
					if field == SkillField.name.rawValue
						|| field == SkillField.enabled.rawValue
						|| field == SkillField.description.rawValue
					{
						listChanged = true
					}
				}
			}
			if listChanged {
				skills = try await client.listSkills()
			}
			if let selectedSkillId {
				await loadDetail(id: selectedSkillId)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func uploadIcon(fileData: Data, filename: String) async {
		guard let dirName = selectedSkillId else { return }
		await flushPendingSave()
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			let base64 = fileData.base64EncodedString()
			_ = try await client.runConfigureAction(
				"upload-skill-icon",
				body: ["dirName": dirName, "imageBase64": base64, "filename": filename],
			)
			skills = try await client.listSkills()
			await loadDetail(id: dirName)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func resetIcon() async {
		guard let dirName = selectedSkillId else { return }
		await flushPendingSave()
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			_ = try await client.runConfigureAction(
				"reset-skill-icon",
				body: ["dirName": dirName],
			)
			skills = try await client.listSkills()
			await loadDetail(id: dirName)
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}
