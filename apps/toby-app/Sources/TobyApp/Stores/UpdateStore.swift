import AppKit
import Foundation
import Observation
import Sparkle

@MainActor
protocol NativeAppUpdating {
	func checkForUpdates() throws
}

@MainActor
protocol AppcastFetchable {
	/// Returns the latest short version string from the appcast feed, or nil if unavailable.
	func fetchLatestVersion() async throws -> String?
}

enum NativeAppUpdateError: LocalizedError {
	case missingSparkleConfiguration
	case cannotCheckForUpdates

	var errorDescription: String? {
		switch self {
		case .missingSparkleConfiguration:
			"Native app updates are not configured for this build."
		case .cannotCheckForUpdates:
			"Toby cannot check for native app updates right now."
		}
	}
}

/// Fetches and parses the Sparkle appcast.xml feed to extract the latest
/// `sparkle:shortVersionString`. This mirrors the same source Sparkle uses
/// for update detection (the SUFeedURL), rather than relying on the
/// GitHub releases changelog API.
@MainActor
final class AppcastFetcher: AppcastFetchable {
	func fetchLatestVersion() async throws -> String? {
		guard let feedURLString = Bundle.main.infoDictionary?["SUFeedURL"] as? String,
			let feedURL = URL(string: feedURLString)
		else {
			return nil
		}

		let (data, _) = try await URLSession.shared.data(from: feedURL)
		return AppcastVersionParser.parse(data: data)
	}
}

/// Extracts the newest `sparkle:shortVersionString` from a Sparkle appcast.
/// Uses `XMLDocument` so namespaced `sparkle:` elements from `generate_appcast`
/// are found; `XMLParserDelegate` methods with default arguments are not
/// registered as the Objective-C selectors, so SAX missed the live feed.
@MainActor
enum AppcastVersionParser {
	static func parse(data: Data) -> String? {
		guard let document = try? XMLDocument(data: data) else { return nil }
		var versions: [String] = []
		if let nodes = try? document.nodes(forXPath: "//*[local-name()='shortVersionString']") {
			versions.append(contentsOf: nodes.compactMap(trimmedStringValue))
		}
		if let attributes = try? document.nodes(forXPath: "//@*[local-name()='shortVersionString']") {
			versions.append(contentsOf: attributes.compactMap(trimmedStringValue))
		}
		return versions.reduce(nil as String?) { newest, raw in
			let version = UpdateStore.normalizedVersion(raw)
			guard let newest else { return version }
			return UpdateStore.isVersionNewer(version, newest) ? version : newest
		}
	}

	private static func trimmedStringValue(_ node: XMLNode) -> String? {
		guard let value = node.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
			!value.isEmpty
		else {
			return nil
		}
		return value
	}
}

@MainActor
final class SparkleNativeAppUpdater: NSObject, NativeAppUpdating {
	private var controller: SPUStandardUpdaterController?

	func checkForUpdates() throws {
		guard isConfigured else {
			throw NativeAppUpdateError.missingSparkleConfiguration
		}

		let controller = updaterController()
		guard controller.updater.canCheckForUpdates else {
			throw NativeAppUpdateError.cannotCheckForUpdates
		}
		controller.checkForUpdates(nil)
	}

	private var isConfigured: Bool {
		guard let info = Bundle.main.infoDictionary else { return false }
		let feedURL = (info["SUFeedURL"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let publicKey = (info["SUPublicEDKey"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return !feedURL.isEmpty && !publicKey.isEmpty
	}

	private func updaterController() -> SPUStandardUpdaterController {
		if let controller {
			return controller
		}
		let controller = SPUStandardUpdaterController(
			startingUpdater: true,
			updaterDelegate: self,
			userDriverDelegate: nil
		)
		self.controller = controller
		return controller
	}
}

extension SparkleNativeAppUpdater: SPUUpdaterDelegate {
	/// Called by Sparkle before relaunching the app after an update.
	/// We postpone the relaunch to stop the daemon server first, ensuring
	/// a clean shutdown rather than leaving the old server process running.
	func updater(
		_ updater: SPUUpdater,
		shouldPostponeRelaunchForUpdate item: SUAppcastItem,
		untilInvokingBlock block: @escaping () -> Void
	) -> Bool {
		Task { @MainActor in
			await stopDaemonBeforeRelaunch()
			block()
		}
		return true
	}

	private func stopDaemonBeforeRelaunch() async {
		let baseURL = ConfigReader.baseURL()
		do {
			try await DaemonBootstrap.stopDaemon(baseURL: baseURL)
		} catch {
			// Best-effort: proceed with relaunch even if the daemon
			// doesn't respond to the stop request. The app will
			// restart the server on next launch.
		}
	}
}

@Observable
@MainActor
final class UpdateStore {
	static let updateTipReshowInterval: TimeInterval = 60 * 60 * 24 * 2
	static let dismissedVersionDefaultsKey = "toby.updateTip.dismissedVersion"
	static let dismissedAtDefaultsKey = "toby.updateTip.dismissedAt"

	var latestVersion: String?
	var currentVersion: String?
	var isUpdateAvailable = false
	var isUpgrading = false
	var upgradeError: String?
	var upgradeComplete = false
	/// Toolbar TipKit popover only. The download button / About / menu stay
	/// available during cooldown.
	var shouldShowUpdateTip = false
	/// Bumped whenever the toolbar tip transitions to shown so TipKit treats it
	/// as a new tip (it otherwise keeps `id: "update-available"` invalidated).
	private(set) var updateTipPresentationNonce = 0

	private let appcastFetcher: AppcastFetchable
	private let nativeUpdater: NativeAppUpdating
	private let defaults: UserDefaults
	private let now: () -> Date
	private var checkTask: Task<Void, Never>?
	private var lastCheckAt: Date?

	init(
		appcastFetcher: AppcastFetchable = AppcastFetcher(),
		nativeUpdater: NativeAppUpdating = SparkleNativeAppUpdater(),
		defaults: UserDefaults = .standard,
		now: @escaping () -> Date = Date.init
	) {
		self.appcastFetcher = appcastFetcher
		self.nativeUpdater = nativeUpdater
		self.defaults = defaults
		self.now = now
		refreshUpdateTipVisibility()
	}

	func startCheckLoop(currentVersionProvider: @escaping () -> String? = UpdateStore.appBundleVersion) {
		checkTask?.cancel()
		checkTask = Task { [weak self] in
			while !Task.isCancelled {
				guard let self else { return }
				let version = currentVersionProvider()
				await self.checkForUpdates(currentVersion: version)
				try? await Task.sleep(nanoseconds: 300_000_000_000)
			}
		}
	}

	static nonisolated func appBundleVersion() -> String? {
		Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
	}

	func stopCheckLoop() {
		checkTask?.cancel()
		checkTask = nil
	}

	func checkForUpdates(currentVersion: String?) async {
		guard let currentVersion, !currentVersion.isEmpty else { return }
		self.currentVersion = UpdateStore.normalizedVersion(currentVersion)
		if let lastCheckAt, Date().timeIntervalSince(lastCheckAt) < 60 {
			refreshUpdateTipVisibility()
			return
		}
		lastCheckAt = Date()

		do {
			guard let latest = try await appcastFetcher.fetchLatestVersion() else {
				refreshUpdateTipVisibility()
				return
			}
			latestVersion = UpdateStore.normalizedVersion(latest)
			isUpdateAvailable = UpdateStore.isVersionNewer(latestVersion ?? latest, currentVersion)
			refreshUpdateTipVisibility()
		} catch {
			// Silently ignore update check failures
			refreshUpdateTipVisibility()
		}
	}

	func dismissUpdateTip() {
		if let latestVersion {
			defaults.set(latestVersion, forKey: Self.dismissedVersionDefaultsKey)
			defaults.set(now(), forKey: Self.dismissedAtDefaultsKey)
		}
		refreshUpdateTipVisibility()
	}

	func refreshUpdateTipVisibility() {
		let shouldShow = computeShouldShowUpdateTip()
		if shouldShow, !shouldShowUpdateTip {
			updateTipPresentationNonce += 1
		}
		shouldShowUpdateTip = shouldShow
	}

	private func computeShouldShowUpdateTip() -> Bool {
		guard isUpdateAvailable,
			let latestVersion, !latestVersion.isEmpty,
			let currentVersion, !currentVersion.isEmpty
		else {
			return false
		}

		let dismissedVersion = defaults.string(forKey: Self.dismissedVersionDefaultsKey)
		let dismissedAt = defaults.object(forKey: Self.dismissedAtDefaultsKey) as? Date
		guard let dismissedVersion, let dismissedAt else {
			return true
		}

		if dismissedVersion != latestVersion {
			return true
		}

		return now().timeIntervalSince(dismissedAt) > Self.updateTipReshowInterval
	}

	static func normalizedVersion(_ version: String) -> String {
		version.hasPrefix("v") ? String(version.dropFirst()) : version
	}

	func performUpgrade() async {
		guard isUpdateAvailable, !isUpgrading else { return }
		await checkNativeAppForUpdates()
	}

	func checkNativeAppForUpdates() async {
		guard !isUpgrading else { return }
		isUpgrading = true
		upgradeError = nil
		upgradeComplete = false
		defer { isUpgrading = false }

		do {
			try nativeUpdater.checkForUpdates()
		} catch {
			upgradeError = error.localizedDescription
		}
	}

	func relaunchApp() {
		let bundleURL = Bundle.main.bundleURL
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/bin/sh")
		process.arguments = ["-c", "sleep 1; open \"\(bundleURL.path)\""]
		try? process.run()
		NSApp.terminate(nil)
	}

	static func isVersionNewer(_ latest: String, _ current: String) -> Bool {
		let normalize: (String) -> [Int] = { version in
			version.replacingOccurrences(of: "v", with: "")
				.split(separator: ".")
				.compactMap { Int($0) }
		}
		let latestParts = normalize(latest)
		let currentParts = normalize(current)
		let length = max(latestParts.count, currentParts.count)
		for i in 0..<length {
			let l = i < latestParts.count ? latestParts[i] : 0
			let c = i < currentParts.count ? currentParts[i] : 0
			if l > c { return true }
			if l < c { return false }
		}
		return false
	}
}
