import Foundation
import Testing
@testable import TobyApp

@MainActor
final class MockUpdateCheckClient: ChangelogFetchable {
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
@Suite("UpdateStore")
struct UpdateStoreTests {
	private func makeRelease(version: String) -> ChangelogRelease {
		ChangelogRelease(
			version: version,
			tagName: "v\(version)",
			url: "https://example.com",
			publishedAt: "2026-06-21T07:33:33Z",
			features: [],
			bugs: [],
			enhancements: []
		)
	}

	private func makeStore(
		response: ChangelogResponse? = nil,
		error: Error? = nil
	) -> (UpdateStore, MockUpdateCheckClient) {
		let client = MockUpdateCheckClient()
		client.response = response
		client.error = error
		let store = UpdateStore(client: client)
		return (store, client)
	}

	@Test("isVersionNewer detects newer version")
	func versionNewerDetection() {
		#expect(UpdateStore.isVersionNewer("0.66.0", "0.65.2") == true)
		#expect(UpdateStore.isVersionNewer("0.65.3", "0.65.2") == true)
		#expect(UpdateStore.isVersionNewer("1.0.0", "0.99.99") == true)
	}

	@Test("isVersionNewer returns false for same or older version")
	func versionNotNewer() {
		#expect(UpdateStore.isVersionNewer("0.65.2", "0.65.2") == false)
		#expect(UpdateStore.isVersionNewer("0.65.1", "0.65.2") == false)
		#expect(UpdateStore.isVersionNewer("0.64.0", "0.65.2") == false)
	}

	@Test("isVersionNewer handles v prefix")
	func versionPrefixHandling() {
		#expect(UpdateStore.isVersionNewer("v0.66.0", "0.65.2") == true)
		#expect(UpdateStore.isVersionNewer("0.66.0", "v0.65.2") == true)
		#expect(UpdateStore.isVersionNewer("v0.66.0", "v0.65.2") == true)
	}

	@Test("checkForUpdates sets isUpdateAvailable when newer version exists")
	func checkDetectsUpdate() async {
		let response = ChangelogResponse(releases: [makeRelease(version: "0.66.0")])
		let (store, client) = makeStore(response: response)
		await store.checkForUpdates(currentVersion: "0.65.2")
		#expect(client.fetchCount == 1)
		#expect(store.latestVersion == "0.66.0")
		#expect(store.isUpdateAvailable == true)
	}

	@Test("checkForUpdates sets isUpdateAvailable false when on latest")
	func checkOnLatest() async {
		let response = ChangelogResponse(releases: [makeRelease(version: "0.65.2")])
		let (store, _) = makeStore(response: response)
		await store.checkForUpdates(currentVersion: "0.65.2")
		#expect(store.latestVersion == "0.65.2")
		#expect(store.isUpdateAvailable == false)
	}

	@Test("checkForUpdates does nothing when currentVersion is nil")
	func checkWithNilVersion() async {
		let response = ChangelogResponse(releases: [makeRelease(version: "0.66.0")])
		let (store, client) = makeStore(response: response)
		await store.checkForUpdates(currentVersion: nil)
		#expect(client.fetchCount == 0)
		#expect(store.isUpdateAvailable == false)
	}

	@Test("checkForUpdates handles fetch error gracefully")
	func checkHandlesError() async {
		let (store, _) = makeStore(error: TobyClientError.invalidResponse)
		await store.checkForUpdates(currentVersion: "0.65.2")
		#expect(store.isUpdateAvailable == false)
		#expect(store.latestVersion == nil)
	}

	@Test("checkForUpdates handles empty releases")
	func checkEmptyReleases() async {
		let response = ChangelogResponse(releases: [])
		let (store, _) = makeStore(response: response)
		await store.checkForUpdates(currentVersion: "0.65.2")
		#expect(store.isUpdateAvailable == false)
		#expect(store.latestVersion == nil)
	}

	@Test("checkForUpdates strips v prefix from latestVersion")
	func checkStripsVPrefix() async {
		let release = ChangelogRelease(
			version: "v0.67.0",
			tagName: "v0.67.0",
			url: "https://example.com",
			publishedAt: "2026-06-21T07:33:33Z",
			features: [],
			bugs: [],
			enhancements: []
		)
		let (store, _) = makeStore(response: ChangelogResponse(releases: [release]))
		await store.checkForUpdates(currentVersion: "0.66.0")
		#expect(store.latestVersion == "0.67.0")
		#expect(store.isUpdateAvailable == true)
	}

	@Test("startCheckLoop retries quickly when version is not yet available")
	func startCheckLoopRetriesQuicklyWhenVersionMissing() async {
		let response = ChangelogResponse(releases: [makeRelease(version: "0.67.0")])
		let (store, client) = makeStore(response: response)

		var version: String? = nil
		store.startCheckLoop(currentVersionProvider: { version })
		// First check: version is nil, no fetch should happen.
		try? await Task.sleep(nanoseconds: 100_000_000)
		#expect(client.fetchCount == 0)

		// Simulate status becoming available.
		version = "0.66.0"
		// The loop should retry within a few seconds (not 5 minutes).
		try? await Task.sleep(nanoseconds: 6_000_000_000)
		#expect(client.fetchCount >= 1)
		#expect(store.isUpdateAvailable == true)
		#expect(store.latestVersion == "0.67.0")

		store.stopCheckLoop()
	}
}
