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

	func replacingRecentRuns(_ recentRuns: [ScheduleRunViewModel]) -> ScheduleViewModel {
		ScheduleViewModel(
			id: id,
			name: name,
			prompt: prompt,
			personaName: personaName,
			projectId: projectId,
			cronExpression: cronExpression,
			cronHumanReadable: cronHumanReadable,
			nextRunAt: nextRunAt,
			enabled: enabled,
			lastRunAt: lastRunAt,
			recentRuns: recentRuns
		)
	}
}

struct ScheduleRunViewModel: Identifiable {
	let id: String
	let label: String
	let status: String
	let startedAt: String?

	/// Rebuilds the configure-tree style label (`date · STATUS`) with an updated status.
	func withStatus(_ newStatus: String) -> ScheduleRunViewModel {
		let normalized = newStatus.lowercased()
		let upper = normalized.uppercased()
		let newLabel: String
		if let range = label.range(of: " · ", options: .backwards) {
			newLabel = String(label[..<range.upperBound]) + upper
		} else {
			newLabel = "\(label) · \(upper)"
		}
		return ScheduleRunViewModel(id: id, label: newLabel, status: normalized, startedAt: startedAt)
	}
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
	var hasLoadedOnce = false
	var lastLoadedAt: Date?
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
	/// Mutex for in-flight configure patches. Kept separate from `isSaving` so
	/// background autosave does not disable Run/Delete controls while typing.
	private var isSaveInFlight = false
	private var loadedTree: SettingsItem?

	/// Clears schedules state after a Toby home directory switch.
	func resetForHomeSwitch() {
		autosaveTask?.cancel()
		autosaveTask = nil
		schedules = []
		selectedScheduleId = nil
		personaOptions = []
		projectOptions = []
		values = [:]
		draft = [:]
		isLoading = false
		isSaving = false
		deletingScheduleId = nil
		runningScheduleId = nil
		parsingCronScheduleId = nil
		hasLoadedOnce = false
		lastLoadedAt = nil
		cronValidationErrors = [:]
		errorMessage = nil
		pendingDelete = nil
		selectedRunId = nil
		selectedRunDetail = nil
		isRunDetailLoading = false
		runDetailError = nil
		isSaveInFlight = false
		loadedTree = nil
	}

	var selectedSchedule: ScheduleViewModel? {
		schedules.first { $0.id == selectedScheduleId }
	}

	func load() async {
		guard !isLoading else { return }
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
			hasLoadedOnce = true
			lastLoadedAt = Date()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func ensureLoaded() async {
		guard !hasLoadedOnce else { return }
		await load()
	}

	/// Re-fetch only the persona option list (called when personas change
	/// externally, e.g. via the Persona Editor window).
	func refreshPersonas() async {
		do {
			personaOptions = try await client.listPersonas()
		} catch {
			// Quiet — next full load retries.
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
			try await fetchAndApplyRunDetail(id: selectedRunId, surfaceError: true)
			startRunDetailPollingIfNeeded()
		} catch {
			runDetailError = error.localizedDescription
		}
	}

	func closeRunDetail() {
		runDetailPollTask?.cancel()
		runDetailPollTask = nil
		selectedRunId = nil
		selectedRunDetail = nil
		runDetailError = nil
	}

	/// Updates local `recentRuns` entries to match a live run detail payload.
	/// Internal for tests (`@testable import`).
	func applyRunDetailToSchedules(_ detail: ScheduleRunDetail) {
		var didChange = false
		schedules = schedules.map { schedule in
			guard schedule.recentRuns.contains(where: { $0.id == detail.id }) else {
				return schedule
			}
			let updatedRuns = schedule.recentRuns.map { run -> ScheduleRunViewModel in
				guard run.id == detail.id else { return run }
				let next = run.withStatus(detail.status)
				if next.status != run.status || next.label != run.label {
					didChange = true
				}
				return next
			}
			return schedule.replacingRecentRuns(updatedRuns)
		}
		if didChange {
			startListPollingIfNeeded()
		}
	}

	private var runDetailPollTask: Task<Void, Never>?
	private var listPollTask: Task<Void, Never>?
	private var isQuietRefreshing = false

	private func listStatus(forRunId runId: String) -> String? {
		for schedule in schedules {
			if let run = schedule.recentRuns.first(where: { $0.id == runId }) {
				return run.status
			}
		}
		return nil
	}

	private func hasRunningRecentRuns() -> Bool {
		schedules.contains { schedule in
			schedule.recentRuns.contains { $0.status == "running" }
		}
	}

	/// Fetches a single run from the API and syncs list + detail state.
	private func fetchAndApplyRunDetail(id: String, surfaceError: Bool) async throws {
		let previousStatus = listStatus(forRunId: id)
		let detail = try await client.fetchScheduleRun(id: id)
		// Ignore late responses if the user closed or switched runs.
		guard selectedRunId == id else { return }
		selectedRunDetail = detail
		// Modal status comes from the live run API; list UIs use the configure-tree
		// snapshot. Propagate the live status so inspector + dashboard stay in sync.
		applyRunDetailToSchedules(detail)
		let transitionedToTerminal = previousStatus == "running" && !detail.isRunning
		if transitionedToTerminal {
			// Refresh tree for last-run metadata and authoritative labels.
			await refreshQuietly()
		}
		if surfaceError {
			runDetailError = nil
		}
	}

	private func startRunDetailPollingIfNeeded() {
		runDetailPollTask?.cancel()
		runDetailPollTask = nil
		guard selectedRunDetail?.isRunning == true, let runId = selectedRunId else { return }
		runDetailPollTask = Task { [weak self] in
			while !Task.isCancelled {
				try? await Task.sleep(nanoseconds: 2_000_000_000)
				guard !Task.isCancelled, let self else { break }
				guard self.selectedRunId == runId, self.selectedRunDetail?.isRunning == true else {
					break
				}
				do {
					// Poll without restarting this task or flipping the loading spinner.
					try await self.fetchAndApplyRunDetail(id: runId, surfaceError: false)
				} catch {
					// Soft-fail polls; keep trying until terminal or dismissed.
				}
			}
		}
	}

	/// Polls the configure tree while any recent run is still `running`, so
	/// dashboard/sidebar list statuses update even when the run modal is closed.
	private func startListPollingIfNeeded() {
		guard hasRunningRecentRuns() else {
			listPollTask?.cancel()
			listPollTask = nil
			return
		}
		guard listPollTask == nil else { return }
		listPollTask = Task { [weak self] in
			while !Task.isCancelled {
				try? await Task.sleep(nanoseconds: 3_000_000_000)
				guard !Task.isCancelled, let self else { break }
				guard self.hasRunningRecentRuns() else {
					self.listPollTask = nil
					break
				}
				await self.refreshQuietly()
			}
		}
	}

	/// Soft re-fetch of the schedules configure tree without flipping `isLoading`.
	private func refreshQuietly() async {
		guard !isQuietRefreshing else { return }
		isQuietRefreshing = true
		defer { isQuietRefreshing = false }
		do {
			let response = try await client.fetchConfigureTree()
			// Preserve in-progress edits; only list/run metadata needs to refresh.
			apply(response: response, resetDraft: false)
		} catch {
			// Quiet refresh failures are non-fatal; next poll or explicit load retries.
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
		// Already a valid crontab — nothing to convert.
		if Self.isValidCronExpression(value) {
			cronValidationErrors[scheduleId] = nil
			return
		}
		parsingCronScheduleId = scheduleId
		errorMessage = nil
		// Suppress "invalid cron" while the LLM converts natural language.
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
		// Don't flash validation UI while a conversion is already in flight (focus often
		// leaves the field when the user clicks Convert).
		guard parsingCronScheduleId != scheduleId else { return }
		let key = key(for: scheduleId, field: .cron)
		let value = self.value(for: key)
		// Clear hard errors on blur when empty or valid. Natural-language text is
		// expected input and is handled as a soft "needs convert" hint in the view —
		// not as a validation error — so we do not set cronValidationErrors for it.
		if value.isEmpty || Self.isValidCronExpression(value) {
			cronValidationErrors[scheduleId] = nil
		}
	}

	/// Soft status while natural-language schedule text is being converted.
	func isParsingCron(for scheduleId: String) -> Bool {
		parsingCronScheduleId == scheduleId
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
		// Typing a new schedule expression invalidates any prior convert failure.
		if key.hasSuffix(".\(ScheduleField.cron.rawValue)"),
			let scheduleId = scheduleId(fromKeyPrefix: key)
		{
			cronValidationErrors[scheduleId] = nil
		}
		scheduleAutosave(immediately: autosaveImmediately)
	}

	private func scheduleId(fromKeyPrefix key: String) -> String? {
		// keys look like "schedules.<id>.cron"
		let parts = key.split(separator: ".")
		guard parts.count == 3, parts[0] == "schedules", parts[2] == "cron" else { return nil }
		return String(parts[1])
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
		if isSaveInFlight {
			// Another patch is running; retry once it finishes if drafts remain dirty.
			scheduleAutosave()
			return
		}
		let changes = allPendingChanges
		guard !changes.isEmpty else { return }
		isSaveInFlight = true
		// Intentionally do not set `isSaving` here — autosave must not disable
		// Run/Delete (or other chrome) while the user is editing.
		defer { isSaveInFlight = false }
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
		// Keep list UIs (inspector + dashboard) in sync while any run is in flight.
		startListPollingIfNeeded()
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
			return ScheduleRunViewModel(id: runId, label: label, status: status, startedAt: node.currentValue)
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
