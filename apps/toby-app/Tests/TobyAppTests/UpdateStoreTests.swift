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
		nativeUpdater: NativeAppUpdating = MockNativeAppUpdater(),
		defaults: UserDefaults? = nil,
		now: @escaping () -> Date = Date.init
	) -> (UpdateStore, MockAppcastFetcher) {
		let fetcher = MockAppcastFetcher()
		fetcher.latestVersion = latestVersion
		fetcher.error = error
		let isolatedDefaults = defaults ?? UserDefaults(suiteName: "toby.tests.update.\(UUID().uuidString)")!
		let store = UpdateStore(
			appcastFetcher: fetcher,
			nativeUpdater: nativeUpdater,
			defaults: isolatedDefaults,
			now: now
		)
		return (store, fetcher)
	}

	private func markUpdateAvailable(
		_ store: UpdateStore,
		current: String = "0.65.2",
		latest: String = "0.66.0"
	) {
		store.currentVersion = current
		store.latestVersion = latest
		store.isUpdateAvailable = true
		store.refreshUpdateTipVisibility()
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

	@Test("checkForUpdates records current version and shows the update tip")
	func checkRecordsCurrentVersionAndShowsTip() async {
		let (store, _) = makeStore(latestVersion: "0.66.0")
		await store.checkForUpdates(currentVersion: "v0.65.2")
		#expect(store.currentVersion == "0.65.2")
		#expect(store.shouldShowUpdateTip == true)
	}

	@Test("update tip stays hidden when already on the latest version")
	func tipHiddenWhenOnLatest() async {
		let (store, _) = makeStore(latestVersion: "0.65.2")
		await store.checkForUpdates(currentVersion: "0.65.2")
		#expect(store.shouldShowUpdateTip == false)
	}

	@Test("update tip shows when never dismissed")
	func tipShowsWhenNeverDismissed() {
		let (store, _) = makeStore()
		markUpdateAvailable(store)
		#expect(store.shouldShowUpdateTip == true)
	}

	@Test("dismissing the update tip hides it for the same version")
	func dismissHidesTipForSameVersion() {
		let (store, _) = makeStore()
		markUpdateAvailable(store)
		store.dismissUpdateTip()
		#expect(store.shouldShowUpdateTip == false)
	}

	@Test("update tip returns more than two days after dismiss")
	func tipReturnsAfterTwoDays() {
		let start = Date(timeIntervalSince1970: 1_700_000_000)
		var now = start
		let (store, _) = makeStore(now: { now })
		markUpdateAvailable(store)
		store.dismissUpdateTip()
		#expect(store.shouldShowUpdateTip == false)

		now = start.addingTimeInterval(UpdateStore.updateTipReshowInterval)
		store.refreshUpdateTipVisibility()
		#expect(store.shouldShowUpdateTip == false)

		now = start.addingTimeInterval(UpdateStore.updateTipReshowInterval + 1)
		store.refreshUpdateTipVisibility()
		#expect(store.shouldShowUpdateTip == true)
	}

	@Test("update tip returns immediately when a newer version is available")
	func tipReturnsForNewerVersion() {
		let (store, _) = makeStore()
		markUpdateAvailable(store, latest: "0.66.0")
		store.dismissUpdateTip()
		#expect(store.shouldShowUpdateTip == false)

		store.latestVersion = "0.67.0"
		store.refreshUpdateTipVisibility()
		#expect(store.shouldShowUpdateTip == true)
	}

	@Test("update tip nonce changes when the tip is shown again")
	func tipNonceChangesOnReshow() {
		let start = Date(timeIntervalSince1970: 1_700_000_000)
		var now = start
		let (store, _) = makeStore(now: { now })
		markUpdateAvailable(store)
		let firstNonce = store.updateTipPresentationNonce
		#expect(firstNonce > 0)

		store.dismissUpdateTip()
		#expect(store.updateTipPresentationNonce == firstNonce)

		now = start.addingTimeInterval(UpdateStore.updateTipReshowInterval + 1)
		store.refreshUpdateTipVisibility()
		#expect(store.shouldShowUpdateTip == true)
		#expect(store.updateTipPresentationNonce == firstNonce + 1)
	}

	@Test("debug override pins a pending update and ignores appcast checks")
	func debugOverrideIgnoresAppcast() async {
		let (store, fetcher) = makeStore(latestVersion: "0.65.2")
		store.applyDebugOverride(latestVersion: "99.0.0", currentVersion: "0.1.0")
		#expect(store.isDebugOverrideActive == true)
		#expect(store.isUpdateAvailable == true)
		#expect(store.latestVersion == "99.0.0")
		#expect(store.currentVersion == "0.1.0")
		#expect(store.shouldShowUpdateTip == true)

		await store.checkForUpdates(currentVersion: "0.165.0")
		#expect(fetcher.fetchCount == 0)
		#expect(store.latestVersion == "99.0.0")
		#expect(store.currentVersion == "0.1.0")
		#expect(store.isUpdateAvailable == true)
	}
}

@MainActor
@Suite("AppcastVersionParser")
struct AppcastVersionParserTests {
	@Test("parses sparkle:shortVersionString elements from generate_appcast XML")
	func parsesGenerateAppcastElement() {
		let xml = """
			<?xml version="1.0" standalone="yes"?>
			<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
			    <channel>
			        <title>Toby</title>
			        <item>
			            <title>0.163.1</title>
			            <sparkle:version>273</sparkle:version>
			            <sparkle:shortVersionString>0.163.1</sparkle:shortVersionString>
			            <enclosure url="https://example.com/Toby-arm64.dmg" length="1" type="application/octet-stream"/>
			        </item>
			    </channel>
			</rss>
			"""
		let version = AppcastVersionParser.parse(data: Data(xml.utf8))
		#expect(version == "0.163.1")
	}

	@Test("parses enclosure shortVersionString attributes")
	func parsesEnclosureAttribute() {
		let xml = """
			<?xml version="1.0" encoding="utf-8"?>
			<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
			  <channel>
			    <item>
			      <enclosure url="https://example.com/Toby.dmg" sparkle:shortVersionString="0.162.0" sparkle:version="200"/>
			    </item>
			  </channel>
			</rss>
			"""
		let version = AppcastVersionParser.parse(data: Data(xml.utf8))
		#expect(version == "0.162.0")
	}

	@Test("selects the newest version when the feed lists several items")
	func selectsNewestVersion() {
		let xml = """
			<?xml version="1.0" encoding="utf-8"?>
			<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
			  <channel>
			    <item>
			      <sparkle:shortVersionString>0.162.0</sparkle:shortVersionString>
			    </item>
			    <item>
			      <sparkle:shortVersionString>0.163.1</sparkle:shortVersionString>
			    </item>
			  </channel>
			</rss>
			"""
		let version = AppcastVersionParser.parse(data: Data(xml.utf8))
		#expect(version == "0.163.1")
	}
}
