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

	private let client = TobyClient()

	/// True while either category is still loading.
	var isLoading: Bool { emailLoading || tasksLoading }

	/// True only during the brief window both categories are starting a fresh
	/// fetch. Used for the refresh button so it isn't held disabled by a single
	/// slow category (e.g. IMAP on a blocked network).
	var isRefreshing: Bool { emailLoading && tasksLoading }

	/// Refresh both categories. Each section updates independently as its
	/// fetch resolves, so a slow provider (e.g. IMAP on a blocked network)
	/// never delays the other category.
	func load() async {
		hasLoadedOnce = true
		lastLoadedAt = Date()
		async let e: Void = loadEmail()
		async let t: Void = loadTasks()
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
}
