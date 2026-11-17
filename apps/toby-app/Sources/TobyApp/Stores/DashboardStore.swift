import Foundation
import Observation

@Observable
@MainActor
final class DashboardStore {
	let registry: DashboardBlockRegistry
	/// The Feed (full-width Home section above the card grid).
	let feed: FeedStore

	var hasLoadedOnce = false

	/// True for the full duration of a global force refresh (toolbar spinner).
	private(set) var isGlobalUpdating = false

	private let client: TobyClient

	init(client: TobyClient = TobyClient()) {
		self.client = client
		self.registry = DashboardBlockRegistry(client: client)
		self.feed = FeedStore(client: client)
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

	func syncFlowBlocks() async {
		do {
			let infos = try await client.fetchFlowDashboardBlocks()
			registry.syncFlowBlocks(infos, client: client)
		} catch {
			// Keep built-ins if the flow-block list fails.
		}
	}

	/// Soft or force refresh: fan-out `block.update` for every registered block.
	/// Single path per block (flow content only).
	func updateAll(force: Bool) async {
		await syncFlowBlocks()
		hasLoadedOnce = true

		if force {
			isGlobalUpdating = true
		}
		defer {
			if force {
				isGlobalUpdating = false
			}
		}

		// Hidden cards aren't refreshed (no summary model calls); they load
		// when shown (`loadVisibleBlocksMissingContent`).
		let prefs = AppearancePreferences.shared
		let layout = prefs.effectiveDashboardLayout(
			feedAvailable: isFeedAvailable(showFeed: prefs.showFeed)
		)
		var tasks = blocks.filter { !layout.isHidden(id: $0.id) }.map { block in
			Task { @MainActor in
				await block.update(force: force)
			}
		}
		if prefs.showFeed {
			let feed = feed
			tasks.append(Task { @MainActor in await feed.update(force: force) })
		}
		for task in tasks {
			await task.value
		}
	}

	/// False while The Feed is off or needs a structured-output model; the
	/// cards it replaced are shown instead.
	func isFeedAvailable(showFeed: Bool) -> Bool {
		showFeed && feed.content?.status != .setupRequired
	}

	/// Soft-loads visible cards that have no content yet (just shown, or
	/// skipped while hidden).
	func loadVisibleBlocksMissingContent(layout: DashboardLayout) async {
		let pending = blocks.filter {
			!layout.isHidden(id: $0.id) && $0.content == nil && !$0.isLoading
		}
		let tasks = pending.map { block in
			Task { @MainActor in await block.update(force: false) }
		}
		for task in tasks {
			await task.value
		}
	}

	/// Clears dashboard block content after a Toby home directory switch.
	func resetForHomeSwitch() {
		hasLoadedOnce = false
		isGlobalUpdating = false
		registry.syncFlowBlocks([], client: client)
		feed.reset()
		for block in blocks {
			block.content = nil
			block.error = nil
			block.isLoading = false
			block.isForceUpdating = false
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
