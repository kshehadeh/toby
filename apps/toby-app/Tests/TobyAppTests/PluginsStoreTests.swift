import Foundation
import Testing
@testable import TobyApp

@MainActor
final class MockPluginsClient: PluginsFetchable {
	var response: PluginsListResponse?
	var error: Error?
	var fetchCount = 0

	func fetchPlugins() async throws -> PluginsListResponse {
		fetchCount += 1
		if let error { throw error }
		guard let response else { throw TobyClientError.invalidResponse }
		return response
	}
}

@MainActor
@Suite("PluginsStore")
struct PluginsStoreTests {
	private func makePlugin(name: String = "slack", displayName: String = "Slack", version: String? = "1.2.0", state: String = "valid", connected: Bool = true) -> PluginSummary {
		PluginSummary(
			name: name,
			displayName: displayName,
			description: nil,
			version: version,
			protocolVersion: "1",
			icon: nil,
			iconUrl: nil,
			state: state,
			connected: connected,
			error: nil,
			errorCode: nil
		)
	}

	private func makeStore(response: PluginsListResponse? = nil, error: Error? = nil) -> (PluginsStore, MockPluginsClient) {
		let client = MockPluginsClient()
		client.response = response
		client.error = error
		let store = PluginsStore(client: client)
		return (store, client)
	}

	@Test("load fetches and sorts plugins by display name")
	func loadFetchesAndSorts() async throws {
		let response = PluginsListResponse(
			directory: "/Users/example/.toby/plugins",
			plugins: [
				makePlugin(name: "slack", displayName: "Slack"),
				makePlugin(name: "gmail", displayName: "Gmail"),
			]
		)
		let (store, client) = makeStore(response: response)
		await store.load()
		#expect(client.fetchCount == 1)
		#expect(store.plugins.count == 2)
		#expect(store.plugins.first?.name == "gmail")
		#expect(store.pluginsDirectory == "/Users/example/.toby/plugins")
		#expect(store.errorMessage == nil)
	}

	@Test("load sets error message on failure")
	func loadSetsErrorOnFailure() async throws {
		let (store, client) = makeStore(error: TobyClientError.invalidResponse)
		await store.load()
		#expect(client.fetchCount == 1)
		#expect(store.plugins.isEmpty)
		#expect(store.errorMessage != nil)
	}

	@Test("statusLabel reflects state and connection")
	func statusLabelReflectsState() {
		let connected = makePlugin(state: "valid", connected: true)
		let disconnected = makePlugin(state: "valid", connected: false)
		let disabled = makePlugin(state: "disabled", connected: false)
		let invalid = makePlugin(state: "invalid", connected: false)
		#expect(connected.statusLabel == "Connected")
		#expect(disconnected.statusLabel == "Disconnected")
		#expect(disabled.statusLabel == "Disabled")
		#expect(invalid.statusLabel == "Invalid")
	}
}
