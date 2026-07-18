import Foundation
import Observation

@Observable
@MainActor
final class DashboardStore {
	var email: DashboardCategorySummary?
	var tasks: DashboardCategorySummary?
	var calendar: DashboardCategorySummary?
	var emailLoading = false
	var tasksLoading = false
	var calendarLoading = false
	var hasLoadedOnce = false
	var emailError: String?
	var tasksError: String?
	var calendarError: String?
	var lastLoadedAt: Date?

	// AI summary state
	var emailSummary: DashboardCategoryAiSummary?
	var tasksSummary: DashboardCategoryAiSummary?
	var calendarSummary: DashboardCategoryAiSummary?
	var emailSummaryLoading = false
	var tasksSummaryLoading = false
	var calendarSummaryLoading = false
	var emailSummaryError: String?
	var tasksSummaryError: String?
	var calendarSummaryError: String?
	var lastSummaryLoadedAt: Date?

	private let client = TobyClient()

	/// Minimum interval between AI summary refreshes (5 minutes).
	private let summaryStaleInterval: TimeInterval = 300

	/// True while any category is still loading.
	var isLoading: Bool { emailLoading || tasksLoading || calendarLoading }

	/// True only during the brief window all categories are starting a fresh
	/// fetch. Used for the refresh button so it isn't held disabled by a single
	/// slow category (e.g. IMAP on a blocked network).
	var isRefreshing: Bool { emailLoading && tasksLoading && calendarLoading }

	/// True while any AI summary is being generated.
	var isSummaryLoading: Bool {
		emailSummaryLoading || tasksSummaryLoading || calendarSummaryLoading
	}

	/// Whether AI summaries are stale enough to warrant a refresh.
	var summariesAreStale: Bool {
		guard let last = lastSummaryLoadedAt else { return true }
		return Date().timeIntervalSince(last) >= summaryStaleInterval
	}

	/// Refresh all categories. Each section updates independently as its
	/// fetch resolves, so a slow provider (e.g. IMAP on a blocked network)
	/// never delays the other categories. Does not load AI summaries — use
	/// `loadSummariesIfStale()` or `reloadSummaries()` separately.
	func load() async {
		hasLoadedOnce = true
		lastLoadedAt = Date()
		async let e: Void = loadEmail()
		async let t: Void = loadTasks()
		async let c: Void = loadCalendar()
		_ = await (e, t, c)
	}

	/// Load AI summaries only if the 5-minute stale interval has passed.
	/// Called when the dashboard view becomes visible. If a persisted (but
	/// stale) summary is returned from the server, a delayed re-fetch is
	/// scheduled to pick up the refreshed data.
	func loadSummariesIfStale() async {
		guard summariesAreStale else { return }
		async let e = loadEmailSummary()
		async let t = loadTasksSummary()
		async let c = loadCalendarSummary()
		let loaded = await (e, t, c)
		if loaded.0 || loaded.1 || loaded.2 {
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
		let calendarIsStale = isSummaryGeneratedAtStale(calendarSummary)

		if emailIsStale || tasksIsStale || calendarIsStale {
			try? await Task.sleep(for: .seconds(3))
			if emailIsStale {
				await loadEmailSummary()
			}
			if tasksIsStale {
				await loadTasksSummary()
			}
			if calendarIsStale {
				await loadCalendarSummary()
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
		async let c = loadCalendarSummary()
		let loaded = await (e, t, c)
		if loaded.0 || loaded.1 || loaded.2 {
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

	/// Force-refresh calendar category data and its AI summary together.
	func refreshCalendar() async {
		await loadCalendar()
		await loadCalendarSummary()
	}

	/// True while email category data or its summary is loading.
	var isEmailRefreshing: Bool { emailLoading || emailSummaryLoading }

	/// True while tasks category data or its summary is loading.
	var isTasksRefreshing: Bool { tasksLoading || tasksSummaryLoading }

	/// True while calendar category data or its summary is loading.
	var isCalendarRefreshing: Bool { calendarLoading || calendarSummaryLoading }

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

	func loadCalendar() async {
		guard !calendarLoading else { return }
		calendarLoading = true
		calendarError = nil
		defer { calendarLoading = false }
		do {
			if let latest = try await client.fetchDashboardCategory("calendar") {
				calendar = latest
			}
		} catch {
			calendarError = error.localizedDescription
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

	@discardableResult
	func loadCalendarSummary() async -> Bool {
		guard !calendarSummaryLoading else { return false }
		guard let calendarData = calendar, calendarData.count > 0 else {
			calendarSummaryError = nil
			return false
		}
		calendarSummaryLoading = true
		calendarSummaryError = nil
		defer { calendarSummaryLoading = false }
		do {
			if let summary = try await client.fetchDashboardCategorySummary("calendar") {
				calendarSummary = summary
			}
			return true
		} catch {
			calendarSummaryError = error.localizedDescription
			return true
		}
	}
}
