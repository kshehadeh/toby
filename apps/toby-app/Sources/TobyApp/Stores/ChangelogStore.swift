import Foundation
import Observation

@MainActor
protocol ChangelogFetchable {
	func fetchChangelog(limit: Int) async throws -> ChangelogResponse
}

extension TobyClient: ChangelogFetchable {}

@Observable
@MainActor
final class ChangelogStore {
	var changelog: ChangelogResponse?
	var isLoading = false
	var errorMessage: String?

	private let client: ChangelogFetchable
	private let cacheInterval: TimeInterval
	private var lastFetchedAt: Date?

	init(client: ChangelogFetchable = TobyClient(), cacheInterval: TimeInterval = 600) {
		self.client = client
		self.cacheInterval = cacheInterval
	}

	func load(force: Bool = false) async {
		if !force, let changelog, let lastFetchedAt, Date().timeIntervalSince(lastFetchedAt) < cacheInterval {
			return
		}

		guard !isLoading else { return }
		isLoading = true
		defer { isLoading = false }
		errorMessage = nil

		do {
			changelog = try await client.fetchChangelog(limit: 10)
			lastFetchedAt = Date()
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}
