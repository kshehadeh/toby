import Foundation
import Observation

@Observable
@MainActor
final class DashboardStore {
	let registry: DashboardBlockRegistry

	var hasLoadedOnce = false
	var lastLoadedAt: Date?

	/// True for the full duration of a global force refresh (toolbar spinner).
	private(set) var isGlobalUpdating = false

	private let client: TobyClient

	init(client: TobyClient = TobyClient()) {
		self.client = client
		self.registry = DashboardBlockRegistry(client: client)
	}

	/// Convenience for tests / registry access.
	var blocks: [CategoryDashboardBlock] { registry.blocks }

	// MARK: - Aggregate flags

	/// True while any block is loading content.
	var isLoading: Bool {
		isGlobalUpdating || blocks.contains { $0.isUpdating }
	}

	/// Toolbar disable / global spinner — entire force refresh.
	var isRefreshing: Bool { isGlobalUpdating }

	// MARK: - Compatibility accessors (tests)

	var emailContent: DashboardBlockContent? {
		get { registry.block(id: .email)?.content }
		set { registry.block(id: .email)?.content = newValue }
	}

	var tasksContent: DashboardBlockContent? {
		get { registry.block(id: .tasks)?.content }
		set { registry.block(id: .tasks)?.content = newValue }
	}

	var calendarContent: DashboardBlockContent? {
		get { registry.block(id: .calendar)?.content }
		set { registry.block(id: .calendar)?.content = newValue }
	}

	/// Legacy aliases used by older tests.
	var emailSummary: DashboardBlockContent? {
		get { emailContent }
		set { emailContent = newValue }
	}

	var tasksSummary: DashboardBlockContent? {
		get { tasksContent }
		set { tasksContent = newValue }
	}

	var calendarSummary: DashboardBlockContent? {
		get { calendarContent }
		set { calendarContent = newValue }
	}

	var email: DashboardCategorySummary? { nil }
	var tasks: DashboardCategorySummary? { nil }
	var calendar: DashboardCategorySummary? { nil }

	var emailSummaryLoading: Bool { registry.block(id: .email)?.isLoading ?? false }
	var tasksSummaryLoading: Bool { registry.block(id: .tasks)?.isLoading ?? false }
	var calendarSummaryLoading: Bool { registry.block(id: .calendar)?.isLoading ?? false }

	var isSummaryLoading: Bool { blocks.contains { $0.isLoading } }

	// MARK: - Public update API

	/// Soft or force refresh: fan-out `block.update` for every registered block.
	/// Single path per block (flow content only).
	func updateAll(force: Bool) async {
		hasLoadedOnce = true
		lastLoadedAt = Date()

		if force {
			isGlobalUpdating = true
		}
		defer {
			if force {
				isGlobalUpdating = false
			}
		}

		let tasks = blocks.map { block in
			Task { @MainActor in
				await block.update(force: force)
			}
		}
		for task in tasks {
			await task.value
		}
	}

	/// Global toolbar refresh — force every block and hold spinner until done.
	func refreshAll() async {
		await updateAll(force: true)
	}

	/// Per-block force refresh.
	func refreshBlock(_ id: DashboardBlockID) async {
		guard let block = registry.block(id: id) else { return }
		await block.update(force: true)
	}

	// MARK: - Legacy names (RootView / DashboardView migration)

	func load() async {
		await updateAll(force: false)
	}

	func loadSummariesIfStale() async {
		// Content is loaded with updateAll; no separate summary path.
	}

	func reloadSummaries() async {
		await updateAll(force: true)
	}

	func refreshEmail() async {
		await refreshBlock(.email)
	}

	func refreshTasks() async {
		await refreshBlock(.tasks)
	}

	func refreshCalendar() async {
		await refreshBlock(.calendar)
	}
}
