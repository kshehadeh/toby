import AppKit
import Foundation
import Observation
import Sparkle

@MainActor
protocol NativeAppUpdating {
	func checkForUpdates() throws
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
	var latestVersion: String?
	var isUpdateAvailable = false
	var isUpgrading = false
	var upgradeError: String?
	var upgradeComplete = false

	private let client: ChangelogFetchable
	private let nativeUpdater: NativeAppUpdating
	private var checkTask: Task<Void, Never>?
	private var lastCheckAt: Date?

	init(
		client: ChangelogFetchable = TobyClient(),
		nativeUpdater: NativeAppUpdating = SparkleNativeAppUpdater()
	) {
		self.client = client
		self.nativeUpdater = nativeUpdater
	}

	func startCheckLoop(currentVersionProvider: @escaping () -> String?) {
		checkTask?.cancel()
		checkTask = Task { [weak self] in
			while !Task.isCancelled {
				guard let self else { return }
				let version = currentVersionProvider()
				await self.checkForUpdates(currentVersion: version)
				// When the version is not yet available (e.g. status still loading),
				// retry quickly instead of waiting the full interval.
				let interval: UInt64 = (version?.isEmpty ?? true) ? 5_000_000_000 : 300_000_000_000
				try? await Task.sleep(nanoseconds: interval)
			}
		}
	}

	func stopCheckLoop() {
		checkTask?.cancel()
		checkTask = nil
	}

	func checkForUpdates(currentVersion: String?) async {
		guard let currentVersion, !currentVersion.isEmpty else { return }
		if let lastCheckAt, Date().timeIntervalSince(lastCheckAt) < 60 {
			return
		}
		lastCheckAt = Date()

		do {
			let response = try await client.fetchChangelog(limit: 1)
			guard let latest = response.releases.first else { return }
			latestVersion = latest.version.hasPrefix("v") ? String(latest.version.dropFirst()) : latest.version
			isUpdateAvailable = UpdateStore.isVersionNewer(latest.version, currentVersion)
		} catch {
			// Silently ignore update check failures
		}
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
