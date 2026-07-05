import Foundation
import Observation

@Observable
@MainActor
final class DashboardStore {
	var email: DashboardCategorySummary?
	var tasks: DashboardCategorySummary?
	var isLoading = false
	var hasLoadedOnce = false
	var errorMessage: String?
	var lastLoadedAt: Date?

	private let client = TobyClient()

	func load() async {
		isLoading = true
		errorMessage = nil
		defer {
			isLoading = false
			hasLoadedOnce = true
		}
		do {
			let data = try await client.fetchDashboard()
			email = data.email
			tasks = data.tasks
			lastLoadedAt = Date()
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}
