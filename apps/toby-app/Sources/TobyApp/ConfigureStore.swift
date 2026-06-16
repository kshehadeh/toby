import Foundation
import Observation

@Observable
@MainActor
final class ConfigureStore {
	var tree: SettingsItem?
	var savedValues: [String: String] = [:]
	var integrationLabels: [String: String] = [:]
	var selectedNavKey: String?
	var expandedKeys: Set<String> = []
	var draft: [String: String] = [:]
	var isLoading = false
	var isSaving = false
	var errorMessage: String?
	var pendingDelete: PendingDelete?

	private let client = TobyClient()
	private var fieldByKey: [String: SettingsItem] = [:]
	@ObservationIgnored private var autosaveTask: Task<Void, Never>?
	@ObservationIgnored private let autosaveDelay: Duration = .milliseconds(450)

	struct PendingDelete {
		let action: String
		let body: [String: String]
		let title: String
		let message: String
		let confirmLabel: String
	}

	var sidebarTree: [SidebarTreeNode] {
		guard let tree else { return [] }
		return ConfigureTreeHelpers.buildSidebarTree(root: tree)
	}

	var selectedSection: SettingsItem? {
		guard let tree, let selectedNavKey else { return nil }
		return ConfigureTreeHelpers.findSectionByNavKey(tree, navKey: selectedNavKey)
	}

	var hasPendingChanges: Bool {
		!allPendingChanges.isEmpty
	}

	var allPendingChanges: [String: String] {
		var changes: [String: String] = [:]
		for (key, draftValue) in draft {
			if fieldByKey[key]?.masked == true {
				guard !draftValue.isEmpty, draftValue != ConfigureConstants.redactedSecret else {
					continue
				}
				changes[key] = draftValue
				continue
			}
			let saved = savedValues[key] ?? ""
			if draftValue != saved {
				changes[key] = draftValue
			}
		}
		return changes
	}

	func load() async {
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			let response = try await client.fetchConfigureTree()
			apply(response: response, resetDraft: true)
			if selectedNavKey == nil {
				selectedNavKey = sidebarTree.first?.navKey
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectSection(_ navKey: String) {
		selectedNavKey = navKey
		if let ancestors = ConfigureTreeHelpers.findSidebarAncestorKeys(sidebarTree, targetKey: navKey) {
			for key in ancestors {
				expandedKeys.insert(key)
			}
		}
		if let selectedNode = ConfigureTreeHelpers.findSidebarNode(sidebarTree, targetKey: navKey),
			!selectedNode.children.isEmpty
		{
			expandedKeys.insert(navKey)
		}
	}

	func toggleExpanded(_ navKey: String) {
		if expandedKeys.contains(navKey) {
			expandedKeys.remove(navKey)
		} else {
			expandedKeys.insert(navKey)
		}
	}

	func value(for key: String) -> String {
		draft[key] ?? savedValues[key] ?? ""
	}

	func setDraftValue(_ key: String, _ value: String, autosaveImmediately: Bool = false) {
		if fieldByKey[key]?.masked == true {
			let saved = savedValues[key] ?? ""
			if value.isEmpty, saved == ConfigureConstants.redactedSecret || saved.isEmpty {
				draft.removeValue(forKey: key)
				scheduleAutosave(immediately: autosaveImmediately)
				return
			}
			if value == saved {
				draft.removeValue(forKey: key)
				scheduleAutosave(immediately: autosaveImmediately)
				return
			}
			draft[key] = value
			scheduleAutosave(immediately: autosaveImmediately)
			return
		}

		let saved = savedValues[key] ?? ""
		if value == saved {
			draft.removeValue(forKey: key)
		} else {
			draft[key] = value
		}
		scheduleAutosave(immediately: autosaveImmediately)
	}

	func save() async {
		await savePendingChanges()
	}

	func flushPendingSave() async {
		autosaveTask?.cancel()
		autosaveTask = nil
		await savePendingChanges()
	}

	private func scheduleAutosave(immediately: Bool = false) {
		autosaveTask?.cancel()
		guard hasPendingChanges else {
			autosaveTask = nil
			return
		}
		autosaveTask = Task { [weak self, autosaveDelay] in
			if !immediately {
				do {
					try await Task.sleep(for: autosaveDelay)
				} catch {
					return
				}
			}
			await self?.runAutosaveTask()
		}
	}

	private func runAutosaveTask() async {
		autosaveTask = nil
		await savePendingChanges()
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
			let response = try await client.patchConfigure(changes: changes)
			apply(response: response, resetDraft: false)
			if hasPendingChanges {
				scheduleAutosave()
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func runAction(_ action: String, body: [String: String]) async {
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			_ = try await client.runConfigureAction(action, body: body)
			let response = try await client.fetchConfigureTree()
			apply(response: response, resetDraft: false)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func requestDelete(for field: SettingsItem, sectionLabel: String) {
		guard let action = ConfigureTreeHelpers.actionForKey(field.key) else { return }
		pendingDelete = PendingDelete(
			action: action.name,
			body: action.body,
			title: "Delete \(field.label)?",
			message: "This will permanently remove \(field.label) from \(sectionLabel).",
			confirmLabel: field.label,
		)
	}

	func confirmDelete() async {
		guard let pendingDelete else { return }
		let action = pendingDelete.action
		let body = pendingDelete.body
		self.pendingDelete = nil
		await runAction(action, body: body)
	}

	func detailFields(for section: SettingsItem) -> [SettingsItem] {
		(section.children ?? []).filter { child in
			if child.kind == .section, !(child.children?.isEmpty ?? true) {
				return false
			}
			if child.kind == .hint, child.key.hasSuffix("._empty") {
				return false
			}
			return true
		}
	}

	private func apply(response: ConfigureTreeResponse, resetDraft: Bool) {
		tree = response.tree
		savedValues = response.values
		integrationLabels = response.integrationLabels ?? [:]
		fieldByKey = indexFields(in: response.tree)
		if resetDraft {
			draft = [:]
		} else {
			pruneDraft()
		}
	}

	private func pruneDraft() {
		for key in draft.keys {
			if fieldByKey[key]?.masked == true {
				let draftValue = draft[key] ?? ""
				if draftValue.isEmpty {
					draft.removeValue(forKey: key)
				}
				continue
			}
			let saved = savedValues[key] ?? ""
			if draft[key] == saved {
				draft.removeValue(forKey: key)
			}
		}
	}

	private func indexFields(in root: SettingsItem) -> [String: SettingsItem] {
		var indexed: [String: SettingsItem] = [:]
		func walk(_ node: SettingsItem) {
			if node.kind != .section {
				indexed[node.key] = node
			}
			for child in node.children ?? [] {
				walk(child)
			}
		}
		walk(root)
		return indexed
	}
}
