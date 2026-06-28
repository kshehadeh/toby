import Foundation
import Observation

@MainActor
protocol PluginsFetchable {
	func fetchPlugins() async throws -> PluginsListResponse
}

extension TobyClient: PluginsFetchable {}

@Observable
@MainActor
final class PluginsStore {
	var plugins: [PluginSummary] = []
	var pluginsDirectory: String?
	var isLoading = false
	var errorMessage: String?

	private let client: PluginsFetchable

	init(client: PluginsFetchable = TobyClient()) {
		self.client = client
	}

	func load() async {
		guard !isLoading else { return }
		isLoading = true
		defer { isLoading = false }
		errorMessage = nil

		do {
			let response = try await client.fetchPlugins()
			pluginsDirectory = response.directory
			plugins = response.plugins.sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}
