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

	/// Full URL for the skill's custom icon, with a cache-busting token so
	/// re-uploads (which reuse the `icon.png` filename) reload in the UI.
	var resolvedIconURL: URL? {
		guard let iconUrl, !iconUrl.isEmpty else { return nil }
		let base = ConfigReader.baseURL().absoluteString
		let token = (updatedAt ?? "")
			.unicodeScalars
			.filter { CharacterSet.alphanumerics.contains($0) }
			.map(String.init)
			.joined()
		let suffix = token.isEmpty ? "" : "?v=\(token)"
		return URL(string: base + iconUrl + suffix)
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
	/// Create / edit sheet draft. Nil when the editor is dismissed.
	var editor: SkillEditorDraft?
	var editorBaseline: SkillEditorDraft?
	var editorError: String?

	var isEditorDirty: Bool {
		guard let editor else { return false }
		return editor != editorBaseline
	}

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
	private var detailLoadTask: Task<Void, Never>?
	private var isQuietRefreshing = false
	/// Bumped on select/deselect so in-flight detail fetches cannot land on a
	/// stale selection.
	private(set) var detailEpoch = 0

	init(client: any SkillsClient = TobyClient()) {
		self.client = client
	}

	/// Clears skills state after a Toby home directory switch.
	func resetForHomeSwitch() {
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
		isQuietRefreshing = false
		editor = nil
		editorBaseline = nil
		editorError = nil
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
				}
			} else {
				selectedSkill = nil
			}
		} catch {
			// Quiet refresh failures are non-fatal; next explicit load retries.
		}
	}

	func selectSkill(id: String) {
		// Re-tapping the selected row should not remount the detail.
		if selectedSkillId == id, selectedSkill != nil { return }
		detailLoadTask?.cancel()
		AppKitFocus.resignTextViewIfNeeded()
		detailEpoch += 1
		let epoch = detailEpoch
		selectedSkillId = id
		selectedSkill = nil
		selectedDetailTab = .about
		isDetailLoading = true

		detailLoadTask = Task { [weak self] in
			guard let self else { return }
			defer {
				if epoch == self.detailEpoch {
					self.isDetailLoading = false
					self.detailLoadTask = nil
				}
			}
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
		detailEpoch += 1
		selectedSkillId = nil
		selectedSkill = nil
		selectedDetailTab = .about
		isDetailLoading = false
	}

	func startCreate() {
		let draft = SkillEditorDraft.blank()
		editor = draft
		editorBaseline = draft
		editorError = nil
	}

	func startEdit() {
		guard let skill = selectedSkill else { return }
		let draft = SkillEditorDraft.from(detail: skill)
		editor = draft
		editorBaseline = draft
		editorError = nil
	}

	func cancelEditor() {
		editor = nil
		editorBaseline = nil
		editorError = nil
	}

	func saveEditor() async {
		guard let draft = editor, draft.canSave else { return }
		isSaving = true
		editorError = nil
		defer { isSaving = false }
		do {
			let dirName: String
			if let existingId = draft.existingId {
				dirName = existingId
				try await persistEditorFields(draft: draft, dirName: dirName, baseline: editorBaseline)
			} else {
				let result = try await client.runConfigureAction("create-skill", body: [:])
				guard let createdId = result.dirName else {
					throw TobyClientError.serverError("Create skill did not return an id")
				}
				dirName = createdId
				try await persistEditorFields(draft: draft, dirName: dirName, baseline: nil)
			}
			try await persistEditorIcon(draft: draft, dirName: dirName)
			skills = try await client.listSkills()
			cancelEditor()
			detailEpoch += 1
			let epoch = detailEpoch
			selectedSkillId = dirName
			selectedDetailTab = .about
			await loadDetail(id: dirName, epoch: epoch)
		} catch {
			editorError = error.localizedDescription
		}
	}

	func deleteSkill(id: String) async {
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
		} catch {
			guard epoch == detailEpoch else { return }
			errorMessage = error.localizedDescription
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

	private func persistEditorFields(
		draft: SkillEditorDraft,
		dirName: String,
		baseline: SkillEditorDraft?
	) async throws {
		func needsUpdate<T: Equatable>(_ keyPath: KeyPath<SkillEditorDraft, T>) -> Bool {
			guard let baseline else { return true }
			return draft[keyPath: keyPath] != baseline[keyPath: keyPath]
		}
		if needsUpdate(\.name) {
			_ = try await client.runConfigureAction(
				"update-skill-field",
				body: ["dirName": dirName, "field": SkillField.name.rawValue, "value": draft.trimmedName],
			)
		}
		if needsUpdate(\.summary) {
			_ = try await client.runConfigureAction(
				"update-skill-field",
				body: ["dirName": dirName, "field": SkillField.summary.rawValue, "value": draft.summary],
			)
		}
		if needsUpdate(\.enabled) {
			_ = try await client.runConfigureAction(
				"update-skill-field",
				body: [
					"dirName": dirName,
					"field": SkillField.enabled.rawValue,
					"value": draft.enabled ? "true" : "false",
				],
			)
		}
		if needsUpdate(\.bodyMarkdown) {
			_ = try await client.runConfigureAction(
				"update-skill-body",
				body: ["dirName": dirName, "body": draft.bodyMarkdown],
			)
		}
	}

	private func persistEditorIcon(draft: SkillEditorDraft, dirName: String) async throws {
		if draft.resetIcon {
			_ = try await client.runConfigureAction(
				"reset-skill-icon",
				body: ["dirName": dirName],
			)
		}
		if let data = draft.pendingIconData, let filename = draft.pendingIconFilename {
			_ = try await client.runConfigureAction(
				"upload-skill-icon",
				body: [
					"dirName": dirName,
					"imageBase64": data.base64EncodedString(),
					"filename": filename,
				],
			)
		}
	}
}
