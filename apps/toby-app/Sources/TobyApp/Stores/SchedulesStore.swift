import Foundation
import Observation

struct ScheduleViewModel: Identifiable {
	let id: String
	let name: String
	let prompt: String
	let personaName: String
	let projectId: String?
	let cronExpression: String
	let cronHumanReadable: String
	let nextRunAt: Date?
	let enabled: Bool
	let lastRunAt: String?
	let recentRuns: [ScheduleRunViewModel]

	init(
		id: String,
		name: String,
		prompt: String,
		personaName: String,
		projectId: String? = nil,
		cronExpression: String,
		cronHumanReadable: String,
		nextRunAt: Date?,
		enabled: Bool,
		lastRunAt: String?,
		recentRuns: [ScheduleRunViewModel]
	) {
		self.id = id
		self.name = name
		self.prompt = prompt
		self.personaName = personaName
		self.projectId = projectId
		self.cronExpression = cronExpression
		self.cronHumanReadable = cronHumanReadable
		self.nextRunAt = nextRunAt
		self.enabled = enabled
		self.lastRunAt = lastRunAt
		self.recentRuns = recentRuns
	}

	var displayName: String {
		name.isEmpty ? "Untitled schedule" : name
	}

	var subtitle: String {
		let cron = cronHumanReadable.isEmpty ? cronExpression : cronHumanReadable
		let parts: [String] = [
			cron.isEmpty ? nil : cron,
			enabled ? nil : "Off",
		].compactMap { $0 }
		return parts.isEmpty ? "Never runs" : parts.joined(separator: " · ")
	}

	var nextRunText: String? {
		guard let nextRunAt else { return nil }
		return CronHelpers.relativeTime(until: nextRunAt)
	}
}

struct ScheduleRunViewModel: Identifiable {
	let id: String
	let label: String
	let status: String
}

enum ScheduleField: String {
	case name = "name"
	case prompt = "prompt"
	case persona = "persona"
	case project = "project"
	case cron = "cron"
	case enabled = "enabled"
	case lastRun = "_lastRun"
}

@Observable
@MainActor
final class SchedulesStore {
	var schedules: [ScheduleViewModel] = []
	var selectedScheduleId: String?
	var personaOptions: [PersonaOption] = []
	var projectOptions: [ProjectSummary] = []
	var values: [String: String] = [:]
	var draft: [String: String] = [:]
	var isLoading = false
	var isSaving = false
	var deletingScheduleId: String?
	var runningScheduleId: String?
	var parsingCronScheduleId: String?
	var cronValidationErrors: [String: String] = [:]
	var errorMessage: String?
	var pendingDelete: PendingDelete?

	var totalCount: Int { schedules.count }
	var activeCount: Int { schedules.filter { $0.enabled }.count }
	var selectedRunId: String?
	var selectedRunDetail: ScheduleRunDetail?
	var isRunDetailLoading = false
	var runDetailError: String?

	struct PendingDelete {
		let scheduleId: String
		let title: String
	}

	private let client = TobyClient()
	private var autosaveTask: Task<Void, Never>?
	private let autosaveDelay: Duration = .milliseconds(450)
	private var loadedTree: SettingsItem?

	var selectedSchedule: ScheduleViewModel? {
		schedules.first { $0.id == selectedScheduleId }
	}

	func load() async {
		isLoading = true
		errorMessage = nil
		defer { isLoading = false }
		do {
			async let treeResponse = client.fetchConfigureTree()
			async let personas = client.listPersonas()
			async let projects = client.listProjects()
			let response = try await treeResponse
			personaOptions = try await personas
			projectOptions = try await projects
			apply(response: response, resetDraft: true)
			if selectedScheduleId == nil || !schedules.contains(where: { $0.id == selectedScheduleId }) {
				selectedScheduleId = schedules.first?.id
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectSchedule(id: String) async {
		await flushPendingSave()
		selectedScheduleId = id
	}

	func createSchedule() async {
		await flushPendingSave()
		isSaving = true
		errorMessage = nil
		defer { isSaving = false }
		do {
			let result = try await client.runConfigureAction("create-schedule", body: [:])
			let response = try await client.fetchConfigureTree()
			apply(response: response, resetDraft: true)
			if let newId = result.scheduleId {
				selectedScheduleId = newId
			} else if let first = schedules.first {
				selectedScheduleId = first.id
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func deleteSchedule(id: String) async {
		guard deletingScheduleId == nil else { return }
		await flushPendingSave()
		deletingScheduleId = id
		errorMessage = nil
		defer { deletingScheduleId = nil }
		do {
			_ = try await client.runConfigureAction("delete-schedule", body: ["scheduleId": id])
			let response = try await client.fetchConfigureTree()
			apply(response: response, resetDraft: true)
			if selectedScheduleId == id {
				selectedScheduleId = schedules.first?.id
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func runSchedule(id: String) async {
		guard runningScheduleId == nil else { return }
		await flushPendingSave()
		runningScheduleId = id
		errorMessage = nil
		defer { runningScheduleId = nil }
		do {
			let result = try await client.runConfigureAction("run-schedule", body: ["scheduleId": id])
			let response = try await client.fetchConfigureTree()
			apply(response: response, resetDraft: false)
			if let runId = result.runId {
				await selectRun(id: runId)
			}
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func selectRun(id: String) async {
		selectedRunId = id
		selectedRunDetail = nil
		runDetailError = nil
		await loadRunDetail()
	}

	func loadRunDetail() async {
		guard let selectedRunId else { return }
		isRunDetailLoading = true
		runDetailError = nil
		defer { isRunDetailLoading = false }
		do {
			selectedRunDetail = try await client.fetchScheduleRun(id: selectedRunId)
			startRunDetailPollingIfNeeded()
		} catch {
			runDetailError = error.localizedDescription
		}
	}

	func closeRunDetail() {
		pollTask?.cancel()
		pollTask = nil
		selectedRunId = nil
		selectedRunDetail = nil
		runDetailError = nil
	}

	private var pollTask: Task<Void, Never>?

	private func startRunDetailPollingIfNeeded() {
		pollTask?.cancel()
		pollTask = nil
		guard selectedRunDetail?.isRunning == true else { return }
		pollTask = Task { [weak self] in
			while !Task.isCancelled, let self, self.selectedRunDetail?.isRunning == true {
				try? await Task.sleep(nanoseconds: 2_000_000_000)
				guard !Task.isCancelled, self.selectedRunDetail?.isRunning == true else { break }
				await self.loadRunDetail()
			}
		}
	}

	func confirmDelete() async {
		guard let pendingDelete else { return }
		let id = pendingDelete.scheduleId
		self.pendingDelete = nil
		await deleteSchedule(id: id)
	}

	func parseCron(for scheduleId: String) async {
		guard parsingCronScheduleId == nil else { return }
		let key = key(for: scheduleId, field: .cron)
		let value = self.value(for: key)
		guard !value.isEmpty else { return }
		parsingCronScheduleId = scheduleId
		errorMessage = nil
		cronValidationErrors[scheduleId] = nil
		defer { parsingCronScheduleId = nil }
		do {
			let converted = try await client.parseCronExpression(input: value)
			setDraftValue(key, converted)
			await save()
			cronValidationErrors[scheduleId] = nil
		} catch {
			cronValidationErrors[scheduleId] = "Could not interpret schedule expression: \(error.localizedDescription)"
		}
	}

	func validateCronOnBlur(for scheduleId: String) {
		let key = key(for: scheduleId, field: .cron)
		let value = self.value(for: key)
		guard !value.isEmpty else {
			cronValidationErrors[scheduleId] = nil
			return
		}
		cronValidationErrors[scheduleId] = Self.isValidCronExpression(value) ? nil : "Not a valid cron expression."
	}

	func isCronValid(for scheduleId: String) -> Bool {
		let value = self.value(for: key(for: scheduleId, field: .cron))
		return !value.isEmpty && Self.isValidCronExpression(value)
	}

	private static func isValidCronExpression(_ expression: String) -> Bool {
		CronHelpers.isValidExpression(expression)
	}

	func value(for key: String) -> String {
		draft[key] ?? values[key] ?? ""
	}

	func setDraftValue(_ key: String, _ value: String, autosaveImmediately: Bool = false) {
		let saved = values[key] ?? ""
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

	func key(for scheduleId: String, field: ScheduleField) -> String {
		"schedules.\(scheduleId).\(field.rawValue)"
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

	private var hasPendingChanges: Bool {
		!allPendingChanges.isEmpty
	}

	private var allPendingChanges: [String: String] {
		var changes: [String: String] = [:]
		for (key, draftValue) in draft {
			let saved = values[key] ?? ""
			if draftValue != saved {
				changes[key] = draftValue
			}
		}
		return changes
	}

	private func apply(response: ConfigureTreeResponse, resetDraft: Bool) {
		loadedTree = response.tree
		values = response.values
		schedules = parseSchedules(from: response.tree, values: response.values)
		if resetDraft {
			draft = [:]
		} else {
			pruneDraft()
		}
	}

	private func pruneDraft() {
		for key in draft.keys {
			let saved = values[key] ?? ""
			if draft[key] == saved {
				draft.removeValue(forKey: key)
			}
		}
	}

	private func parseSchedules(
		from tree: SettingsItem,
		values: [String: String],
	) -> [ScheduleViewModel] {
		guard let schedulesSection = ConfigureTreeHelpers.findSectionByNavKey(tree, navKey: "schedules") else {
			return []
		}
		return (schedulesSection.children ?? []).compactMap { node -> ScheduleViewModel? in
			guard node.kind == .section, let id = scheduleId(from: node.key) else { return nil }
			let name = values[key(for: id, field: .name)] ?? node.label
			let prompt = values[key(for: id, field: .prompt)] ?? ""
			let persona = values[key(for: id, field: .persona)] ?? ""
			let projectValue = values[key(for: id, field: .project)] ?? "(none)"
			let cron = values[key(for: id, field: .cron)] ?? ""
			let cronCurrentValue = findChild(node, key: key(for: id, field: .cron))?.currentValue
			let cronHumanReadable = cronHumanReadable(from: cron, currentValue: cronCurrentValue)
			let enabled = values[key(for: id, field: .enabled)]?.lowercased() == "yes"
			let nextRunAt = enabled ? CronHelpers.nextRunDate(for: cron) : nil
			let lastRun = values[key(for: id, field: .lastRun)]
			let runs = parseRuns(from: node, scheduleId: id)
			return ScheduleViewModel(
				id: id,
				name: name,
				prompt: prompt,
				personaName: persona,
				projectId: projectValue == "(none)" ? nil : projectValue,
				cronExpression: cron,
				cronHumanReadable: cronHumanReadable,
				nextRunAt: nextRunAt,
				enabled: enabled,
				lastRunAt: lastRun,
				recentRuns: runs
			)
		}
	}

	private func scheduleId(from key: String) -> String? {
		let prefix = "schedules."
		guard key.hasPrefix(prefix) else { return nil }
		let suffix = String(key.dropFirst(prefix.count))
		guard !suffix.isEmpty, !suffix.hasPrefix("_") else { return nil }
		return suffix
	}

	private func findChild(_ node: SettingsItem, key: String) -> SettingsItem? {
		node.children?.first { $0.key == key }
	}

	private func cronHumanReadable(from expression: String, currentValue: String?) -> String {
		if let currentValue, let start = currentValue.range(of: "("), let end = currentValue.range(of: ")", range: start.upperBound..<currentValue.endIndex) {
			let human = String(currentValue[start.upperBound..<end.lowerBound])
			if !human.isEmpty { return human }
		}
		return CronHelpers.describe(expression)
	}

	private func parseRuns(
		from scheduleNode: SettingsItem,
		scheduleId: String,
	) -> [ScheduleRunViewModel] {
		let prefix = "schedules.\(scheduleId).runs."
		return (scheduleNode.children ?? []).compactMap { node -> ScheduleRunViewModel? in
			guard node.key.hasPrefix(prefix) else { return nil }
			let runId = String(node.key.dropFirst(prefix.count))
			guard !runId.isEmpty else { return nil }
			let label = node.label
			let status = runStatus(from: label)
			return ScheduleRunViewModel(id: runId, label: label, status: status)
		}
	}

	private func runStatus(from label: String) -> String {
		let upper = label.uppercased()
		if upper.contains("SUCCESS") { return "success" }
		if upper.contains("ERROR") { return "error" }
		if upper.contains("RUNNING") { return "running" }
		return "unknown"
	}
}
