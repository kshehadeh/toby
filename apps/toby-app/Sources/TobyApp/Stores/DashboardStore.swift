import Foundation
import Observation

@Observable
@MainActor
final class DashboardStore {
	var email: DashboardCategorySummary?
	var tasks: DashboardCategorySummary?
	var emailLoading = false
	var tasksLoading = false
	var hasLoadedOnce = false
	var emailError: String?
	var tasksError: String?
	var lastLoadedAt: Date?

	// AI summary state
	var emailSummary: DashboardCategoryAiSummary?
	var tasksSummary: DashboardCategoryAiSummary?
	var emailSummaryLoading = false
	var tasksSummaryLoading = false
	var emailSummaryError: String?
	var tasksSummaryError: String?
	var lastSummaryLoadedAt: Date?

	private let client = TobyClient()

	/// Minimum interval between AI summary refreshes (5 minutes).
	private let summaryStaleInterval: TimeInterval = 300

	/// True while either category is still loading.
	var isLoading: Bool { emailLoading || tasksLoading }

	/// True only during the brief window both categories are starting a fresh
	/// fetch. Used for the refresh button so it isn't held disabled by a single
	/// slow category (e.g. IMAP on a blocked network).
	var isRefreshing: Bool { emailLoading && tasksLoading }

	/// True while either AI summary is being generated.
	var isSummaryLoading: Bool { emailSummaryLoading || tasksSummaryLoading }

	/// Whether AI summaries are stale enough to warrant a refresh.
	var summariesAreStale: Bool {
		guard let last = lastSummaryLoadedAt else { return true }
		return Date().timeIntervalSince(last) >= summaryStaleInterval
	}

	/// Refresh both categories. Each section updates independently as its
	/// fetch resolves, so a slow provider (e.g. IMAP on a blocked network)
	/// never delays the other category. Does not load AI summaries — use
	/// `loadSummariesIfStale()` or `reloadSummaries()` separately.
	func load() async {
		hasLoadedOnce = true
		lastLoadedAt = Date()
		async let e: Void = loadEmail()
		async let t: Void = loadTasks()
		_ = await (e, t)
	}

	/// Load AI summaries only if the 5-minute stale interval has passed.
	/// Called when the dashboard view becomes visible.
	func loadSummariesIfStale() async {
		guard summariesAreStale else { return }
		lastSummaryLoadedAt = Date()
		async let e: Void = loadEmailSummary()
		async let t: Void = loadTasksSummary()
		_ = await (e, t)
	}

	/// Force-refresh summaries regardless of staleness (e.g. manual refresh).
	func reloadSummaries() async {
		lastSummaryLoadedAt = Date()
		async let e: Void = loadEmailSummary()
		async let t: Void = loadTasksSummary()
		_ = await (e, t)
	}

	func loadEmail() async {
		guard !emailLoading else { return }
		emailLoading = true
		emailError = nil
		defer { emailLoading = false }
		do {
			email = try await client.fetchDashboardCategory("email")
		} catch {
			emailError = error.localizedDescription
		}
	}

	func loadTasks() async {
		guard !tasksLoading else { return }
		tasksLoading = true
		tasksError = nil
		defer { tasksLoading = false }
		do {
			tasks = try await client.fetchDashboardCategory("tasks")
		} catch {
			tasksError = error.localizedDescription
		}
	}

	func loadEmailSummary() async {
		guard !emailSummaryLoading else { return }
		emailSummaryLoading = true
		emailSummaryError = nil
		defer { emailSummaryLoading = false }
		do {
			emailSummary = try await client.fetchDashboardCategorySummary("email")
		} catch {
			emailSummaryError = error.localizedDescription
		}
	}

	func loadTasksSummary() async {
		guard !tasksSummaryLoading else { return }
		tasksSummaryLoading = true
		tasksSummaryError = nil
		defer { tasksSummaryLoading = false }
		do {
			tasksSummary = try await client.fetchDashboardCategorySummary("tasks")
		} catch {
			tasksSummaryError = error.localizedDescription
		}
	}
}
