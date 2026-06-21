import Foundation
import Testing
@testable import TobyApp

@MainActor
final class MockChangelogClient: ChangelogFetchable {
	var response: ChangelogResponse?
	var error: Error?
	var fetchCount = 0

	func fetchChangelog(limit: Int) async throws -> ChangelogResponse {
		fetchCount += 1
		if let error { throw error }
		guard let response else { throw TobyClientError.invalidResponse }
		return response
	}
}

@MainActor
@Suite("ChangelogStore")
struct ChangelogStoreTests {
	private func makeResponse() -> ChangelogResponse {
		ChangelogResponse(releases: [
			ChangelogRelease(
				version: "0.53.3",
				tagName: "v0.53.3",
				url: "https://example.com",
				publishedAt: "2026-06-21T07:33:33Z",
				features: [ChangelogChange(type: "feat", scope: "app", description: "New feature", sha: nil)],
				bugs: [],
				enhancements: []
			),
		])
	}

	private func makeStore(
		response: ChangelogResponse? = nil,
		error: Error? = nil,
		cacheInterval: TimeInterval = 600
	) -> (ChangelogStore, MockChangelogClient) {
		let client = MockChangelogClient()
		client.response = response
		client.error = error
		let store = ChangelogStore(client: client, cacheInterval: cacheInterval)
		return (store, client)
	}

	@Test("load fetches when no cache exists")
	func loadFetchesWhenNoCache() async throws {
		let response = makeResponse()
		let (store, client) = makeStore(response: response)
		await store.load()
		#expect(client.fetchCount == 1)
		#expect(store.changelog?.releases.count == 1)
		#expect(store.errorMessage == nil)
	}

	@Test("load uses cached data within cache interval")
	func loadUsesCacheWithinInterval() async throws {
		let response = makeResponse()
		let (store, client) = makeStore(response: response)
		await store.load()
		#expect(client.fetchCount == 1)
		await store.load()
		#expect(client.fetchCount == 1)
		#expect(store.changelog?.releases.count == 1)
	}

	@Test("load refetches after cache interval expires")
	func loadRefetchesAfterInterval() async throws {
		let response = makeResponse()
		let (store, client) = makeStore(response: response, cacheInterval: -1)
		await store.load()
		#expect(client.fetchCount == 1)
		await store.load()
		#expect(client.fetchCount == 2)
	}

	@Test("load force ignores cache")
	func loadForceIgnoresCache() async throws {
		let response = makeResponse()
		let (store, client) = makeStore(response: response)
		await store.load()
		#expect(client.fetchCount == 1)
		await store.load(force: true)
		#expect(client.fetchCount == 2)
	}

	@Test("load sets error message on failure")
	func loadSetsErrorOnFailure() async throws {
		let (store, client) = makeStore(error: TobyClientError.invalidResponse)
		await store.load()
		#expect(client.fetchCount == 1)
		#expect(store.changelog == nil)
		#expect(store.errorMessage != nil)
	}
}
