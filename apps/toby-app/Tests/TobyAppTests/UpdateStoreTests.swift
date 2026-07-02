import Foundation
import Testing
@testable import TobyApp

@MainActor
final class MockAppcastFetcher: AppcastFetchable {
	var latestVersion: String?
	var error: Error?
	var fetchCount = 0

	func fetchLatestVersion() async throws -> String? {
		fetchCount += 1
		if let error { throw error }
		return latestVersion
	}
}

@MainActor
final class MockNativeAppUpdater: NativeAppUpdating {
	var checkCount = 0
	var error: Error?

	func checkForUpdates() throws {
		checkCount += 1
		if let error {
			throw error
		}
	}
}

@MainActor
@Suite("UpdateStore")
struct UpdateStoreTests {
	private func makeStore(
		latestVersion: String? = nil,
		error: Error? = nil,
		nativeUpdater: NativeAppUpdating = MockNativeAppUpdater()
	) -> (UpdateStore, MockAppcastFetcher) {
		let fetcher = MockAppcastFetcher()
		fetcher.latestVersion = latestVersion
		fetcher.error = error
		let store = UpdateStore(appcastFetcher: fetcher, nativeUpdater: nativeUpdater)
		return (store, fetcher)
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

	@Test("checkForUpdates sets isUpdateAvailable when newer version exists in appcast")
	func checkDetectsUpdate() async {
		let (store, fetcher) = makeStore(latestVersion: "0.66.0")
		await store.checkForUpdates(currentVersion: "0.65.2")
		#expect(fetcher.fetchCount == 1)
		#expect(store.latestVersion == "0.66.0")
		#expect(store.isUpdateAvailable == true)
	}

	@Test("checkForUpdates sets isUpdateAvailable false when on latest")
	func checkOnLatest() async {
		let (store, _) = makeStore(latestVersion: "0.65.2")
		await store.checkForUpdates(currentVersion: "0.65.2")
		#expect(store.latestVersion == "0.65.2")
		#expect(store.isUpdateAvailable == false)
	}

	@Test("checkForUpdates does nothing when currentVersion is nil")
	func checkWithNilVersion() async {
		let (store, fetcher) = makeStore(latestVersion: "0.66.0")
		await store.checkForUpdates(currentVersion: nil)
		#expect(fetcher.fetchCount == 0)
		#expect(store.isUpdateAvailable == false)
	}

	@Test("checkForUpdates handles fetch error gracefully")
	func checkHandlesError() async {
		let (store, _) = makeStore(error: URLError(.notConnectedToInternet))
		await store.checkForUpdates(currentVersion: "0.65.2")
		#expect(store.isUpdateAvailable == false)
		#expect(store.latestVersion == nil)
	}

	@Test("checkForUpdates handles nil version from appcast")
	func checkHandlesNilAppcastVersion() async {
		let (store, fetcher) = makeStore(latestVersion: nil)
		await store.checkForUpdates(currentVersion: "0.65.2")
		#expect(fetcher.fetchCount == 1)
		#expect(store.isUpdateAvailable == false)
		#expect(store.latestVersion == nil)
	}

	@Test("checkForUpdates strips v prefix from latestVersion")
	func checkStripsVPrefix() async {
		let (store, _) = makeStore(latestVersion: "v0.67.0")
		await store.checkForUpdates(currentVersion: "0.66.0")
		#expect(store.latestVersion == "0.67.0")
		#expect(store.isUpdateAvailable == true)
	}

	@Test("performUpgrade delegates to native app updater")
	func performUpgradeDelegatesToNativeUpdater() async {
		let updater = MockNativeAppUpdater()
		let (store, _) = makeStore(nativeUpdater: updater)
		store.isUpdateAvailable = true

		await store.performUpgrade()

		#expect(updater.checkCount == 1)
		#expect(store.upgradeError == nil)
		#expect(store.isUpgrading == false)
	}

	@Test("performUpgrade reports native updater errors")
	func performUpgradeReportsNativeUpdaterError() async {
		let updater = MockNativeAppUpdater()
		updater.error = NativeAppUpdateError.missingSparkleConfiguration
		let (store, _) = makeStore(nativeUpdater: updater)
		store.isUpdateAvailable = true

		await store.performUpgrade()

		#expect(updater.checkCount == 1)
		#expect(store.upgradeError == NativeAppUpdateError.missingSparkleConfiguration.localizedDescription)
		#expect(store.isUpgrading == false)
	}

	@Test("startCheckLoop checks for updates periodically")
	func startCheckLoopChecksPeriodically() async {
		let (store, fetcher) = makeStore(latestVersion: "0.67.0")

		store.startCheckLoop(currentVersionProvider: { "0.66.0" })
		// Give the loop time to run at least one check.
		try? await Task.sleep(nanoseconds: 100_000_000)
		#expect(fetcher.fetchCount >= 1)
		#expect(store.isUpdateAvailable == true)
		#expect(store.latestVersion == "0.67.0")

		store.stopCheckLoop()
	}
}
