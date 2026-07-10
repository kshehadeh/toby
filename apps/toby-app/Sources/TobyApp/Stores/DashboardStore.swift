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
	/// Called when the dashboard view becomes visible. If a persisted (but
	/// stale) summary is returned from the server, a delayed re-fetch is
	/// scheduled to pick up the refreshed data.
	func loadSummariesIfStale() async {
		guard summariesAreStale else { return }
		async let e = loadEmailSummary()
		async let t = loadTasksSummary()
		let loaded = await (e, t)
		if loaded.0 || loaded.1 {
			lastSummaryLoadedAt = Date()
		}

		// If the returned summaries are stale (from disk persistence),
		// schedule a delayed re-fetch to pick up fresh data.
		await scheduleReFetchIfStale()
	}

	/// Check if loaded summaries have old `generatedAt` timestamps and
	/// re-fetch them after a short delay so the server's background refresh
	/// has time to complete.
	private func scheduleReFetchIfStale() async {
		let emailIsStale = isSummaryGeneratedAtStale(emailSummary)
		let tasksIsStale = isSummaryGeneratedAtStale(tasksSummary)

		if emailIsStale || tasksIsStale {
			try? await Task.sleep(for: .seconds(3))
			if emailIsStale {
				await loadEmailSummary()
			}
			if tasksIsStale {
				await loadTasksSummary()
			}
		}
	}

	/// True if the summary's `generatedAt` is older than the stale interval.
	private func isSummaryGeneratedAtStale(_ summary: DashboardCategoryAiSummary?) -> Bool {
		guard let summary else { return false }
		guard let generated = DashboardDate.parse(summary.generatedAt) else {
			return true
		}
		return Date().timeIntervalSince(generated) >= summaryStaleInterval
	}

	/// Force-refresh summaries regardless of staleness (e.g. manual refresh).
	func reloadSummaries() async {
		async let e = loadEmailSummary()
		async let t = loadTasksSummary()
		let loaded = await (e, t)
		if loaded.0 || loaded.1 {
			lastSummaryLoadedAt = Date()
		}
	}

	/// Force-refresh email category data and its AI summary together.
	/// Data is fetched first so the summary can use the latest items.
	func refreshEmail() async {
		await loadEmail()
		await loadEmailSummary()
	}

	/// Force-refresh tasks category data and its AI summary together.
	/// Data is fetched first so the summary can use the latest items.
	func refreshTasks() async {
		await loadTasks()
		await loadTasksSummary()
	}

	/// True while email category data or its summary is loading.
	var isEmailRefreshing: Bool { emailLoading || emailSummaryLoading }

	/// True while tasks category data or its summary is loading.
	var isTasksRefreshing: Bool { tasksLoading || tasksSummaryLoading }

	func loadEmail() async {
		guard !emailLoading else { return }
		emailLoading = true
		emailError = nil
		defer { emailLoading = false }
		do {
			if let latest = try await client.fetchDashboardCategory("email") {
				email = latest
			}
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
			if let latest = try await client.fetchDashboardCategory("tasks") {
				tasks = latest
			}
		} catch {
			tasksError = error.localizedDescription
		}
	}

	@discardableResult
	func loadEmailSummary() async -> Bool {
		guard !emailSummaryLoading else { return false }
		guard let emailData = email, emailData.count > 0 else {
			emailSummaryError = nil
			return false
		}
		emailSummaryLoading = true
		emailSummaryError = nil
		defer { emailSummaryLoading = false }
		do {
			if let summary = try await client.fetchDashboardCategorySummary("email") {
				emailSummary = summary
			}
			return true
		} catch {
			emailSummaryError = error.localizedDescription
			return true
		}
	}

	@discardableResult
	func loadTasksSummary() async -> Bool {
		guard !tasksSummaryLoading else { return false }
		guard let tasksData = tasks, tasksData.count > 0 else {
			tasksSummaryError = nil
			return false
		}
		tasksSummaryLoading = true
		tasksSummaryError = nil
		defer { tasksSummaryLoading = false }
		do {
			if let summary = try await client.fetchDashboardCategorySummary("tasks") {
				tasksSummary = summary
			}
			return true
		} catch {
			tasksSummaryError = error.localizedDescription
			return true
		}
	}
}
