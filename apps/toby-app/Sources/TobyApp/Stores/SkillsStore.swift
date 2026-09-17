import Foundation
import Observation

struct SkillListItem: Decodable, Identifiable {
	let dirName: String
	let name: String
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
		summary = try c.decodePreferredString(
			forKey: .summary,
			fallingBackTo: .description
		)
		enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
		iconUrl = try c.decodeIfPresent(String.self, forKey: .iconUrl)
		createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
		updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
	}
}

struct SkillDetail: Decodable, Identifiable {
	let dirName: String
	let name: String
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
		summary = try c.decodePreferredString(
			forKey: .summary,
			fallingBackTo: .description
		)
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
	case summary = "summary"
	case enabled = "enabled"
	case body = "body"
}

@MainActor
protocol SkillsClient {
	func listSkills() async throws -> [SkillListItem]
	func fetchSkill(dirName: String) async throws -> SkillDetail
	func runConfigureAction(
		_ action: String,
		body: [String: String]
	) async throws -> ConfigureActionResponse
}

extension TobyClient: SkillsClient {}

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
	/// About / Instructions tab in the skill detail.
	var selectedDetailTab: SkillDetailTab = .about

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

	private let client: any SkillsClient
	private var autosaveTask: Task<Void, Never>?
	private var detailLoadTask: Task<Void, Never>?
	private let autosaveDelay: Duration = .milliseconds(450)
	private var draft: [String: String] = [:]
	private var isQuietRefreshing = false
	/// Bumped on select/deselect so in-flight detail fetches cannot land on a
	/// stale selection.
	private(set) var detailEpoch = 0

	init(client: any SkillsClient = TobyClient()) {
		self.client = client
	}

	/// Clears skills state after a Toby home directory switch.
	func resetForHomeSwitch() {
		autosaveTask?.cancel()
		autosaveTask = nil
		detailLoadTask?.cancel()
		detailLoadTask = nil
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
		selectedDetailTab = .about
		isDirty = false
		draft = [:]
		isQuietRefreshing = false
		detailEpoch += 1
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
		let requestedId = selectedSkillId
		let epoch = detailEpoch
		isQuietRefreshing = true
		defer { isQuietRefreshing = false }
		do {
			try await loadListData()
			guard epoch == detailEpoch, requestedId == selectedSkillId else { return }
			if let requestedId, skills.contains(where: { $0.id == requestedId }) {
				if let detail = try? await client.fetchSkill(dirName: requestedId) {
					guard epoch == detailEpoch, selectedSkillId == requestedId else { return }
					selectedSkill = detail
					pruneDraft()
				}
			} else {
				selectedSkill = nil
			}
		} catch {
			// Quiet refresh failures are non-fatal; next explicit load retries.
		}
	}

	func selectSkill(id: String) {
		// Re-tapping the selected row should not remount the AppKit markdown editor.
		if selectedSkillId == id, selectedSkill != nil { return }
		detailLoadTask?.cancel()
		AppKitFocus.resignTextViewIfNeeded()
		let pendingChanges = allPendingChanges
		autosaveTask?.cancel()
		autosaveTask = nil
		detailEpoch += 1
		let epoch = detailEpoch
		selectedSkillId = id
		selectedSkill = nil
		selectedDetailTab = .about
		isDetailLoading = true

		// Record selection intent before the first suspension. A later selection
		// or deselection cancels this entire save/fetch sequence.
		detailLoadTask = Task { [weak self] in
			guard let self else { return }
			defer {
				if epoch == self.detailEpoch {
					self.isDetailLoading = false
					self.detailLoadTask = nil
				}
			}
			await self.persistPendingChanges(
				changes: pendingChanges,
				reloadDetail: false
			)
			guard !Task.isCancelled,
				epoch == self.detailEpoch,
				self.selectedSkillId == id
			else { return }
			await self.loadDetail(id: id, epoch: epoch)
		}
	}

	func selectHome() {
		detailLoadTask?.cancel()
		detailLoadTask = nil
		AppKitFocus.resignTextViewIfNeeded()
		let pendingChanges = allPendingChanges
		autosaveTask?.cancel()
		autosaveTask = nil
		detailEpoch += 1
		selectedSkillId = nil
		selectedSkill = nil
		selectedDetailTab = .about
		isDetailLoading = false

		// Deselecting keeps the feature mounted, so flush now rather than waiting
		// for `SkillsView.onDisappear`.
		Task { [weak self] in
			await self?.persistPendingChanges(
				changes: pendingChanges,
				reloadDetail: false
			)
		}
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
				detailEpoch += 1
				let epoch = detailEpoch
				selectedSkillId = newId
				selectedDetailTab = .about
				await loadDetail(id: newId, epoch: epoch)
			} else if let first = skills.first {
				detailEpoch += 1
				let epoch = detailEpoch
				selectedSkillId = first.id
				selectedDetailTab = .about
				await loadDetail(id: first.id, epoch: epoch)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func deleteSkill(id: String) async {
		await flushPendingSave()
		detailLoadTask?.cancel()
		detailLoadTask = nil
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
				AppKitFocus.resignTextViewIfNeeded()
				detailEpoch += 1
				selectedSkillId = nil
				selectedSkill = nil
				isDetailLoading = false
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

	func flushPendingSave(reloadDetail: Bool = true) async {
		autosaveTask?.cancel()
		autosaveTask = nil
		await persistPendingChanges(changes: nil, reloadDetail: reloadDetail)
	}

	private func persistPendingChanges(
		changes: [String: String]?,
		reloadDetail: Bool
	) async {
		while isSaving {
			guard !Task.isCancelled else { return }
			do {
				try await Task.sleep(for: .milliseconds(20))
			} catch {
				return
			}
		}
		guard !Task.isCancelled else { return }
		await savePendingChanges(changes: changes, reloadDetail: reloadDetail)
	}

	private func loadDetail(id: String, epoch: Int? = nil) async {
		let epoch = epoch ?? detailEpoch
		isDetailLoading = true
		errorMessage = nil
		defer {
			if epoch == detailEpoch {
				isDetailLoading = false
			}
		}
		do {
			let loaded = try await client.fetchSkill(dirName: id)
			guard epoch == detailEpoch, selectedSkillId == id else { return }
			selectedSkill = loaded
			pruneDraft()
		} catch {
			guard epoch == detailEpoch else { return }
			errorMessage = error.localizedDescription
			// If we have nothing to show, drop the dangling selection so the
			// detail pane cannot stick on a spinner after a failed fetch.
			if selectedSkill?.id != id {
				selectedSkill = nil
			}
		}
	}

	private func loadListData() async throws {
		skills = try await client.listSkills()
		if let selectedSkillId, !skills.contains(where: { $0.id == selectedSkillId }) {
			self.selectedSkillId = nil
			selectedSkill = nil
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

	private func savePendingChanges(
		changes suppliedChanges: [String: String]? = nil,
		reloadDetail: Bool = true
	) async {
		if isSaving {
			scheduleAutosave()
			return
		}
		let changes = suppliedChanges ?? allPendingChanges
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
						|| field == SkillField.summary.rawValue
					{
						listChanged = true
					}
				}
			}
			for (key, savedValue) in changes where draft[key] == savedValue {
				draft.removeValue(forKey: key)
			}
			if listChanged {
				skills = try await client.listSkills()
			}
			if reloadDetail, let selectedSkillId {
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
			await loadDetail(id: dirName, epoch: detailEpoch)
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
			await loadDetail(id: dirName, epoch: detailEpoch)
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}
