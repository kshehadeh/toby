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

/// Simple SAX parser that extracts the first `sparkle:shortVersionString`
/// from a Sparkle appcast RSS feed. Handles both attribute-on-enclosure
/// and standalone-element forms.
private final class AppcastVersionParser: NSObject, XMLParserDelegate {
	private var shortVersionString: String?
	private var currentText: String?

	static func parse(data: Data) -> String? {
		let parser = AppcastVersionParser()
		let xmlParser = XMLParser(data: data)
		xmlParser.delegate = parser
		xmlParser.parse()
		return parser.shortVersionString
	}

	func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
		currentText = ""

		// sparkle:shortVersionString as attribute on <enclosure>
		if shortVersionString == nil {
			for (key, value) in attributeDict {
				if key.hasSuffix("shortVersionString") {
					shortVersionString = value
					break
				}
			}
		}
	}

	func parser(_ parser: XMLParser, foundCharacters string: String) {
		currentText? += string
	}

	func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
		// sparkle:shortVersionString as standalone element
		if shortVersionString == nil,
			let text = currentText?.trimmingCharacters(in: .whitespacesAndNewlines),
			!text.isEmpty,
			elementName.hasSuffix("shortVersionString")
		{
			shortVersionString = text
		}
		currentText = nil
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

	private let appcastFetcher: AppcastFetchable
	private let nativeUpdater: NativeAppUpdating
	private var checkTask: Task<Void, Never>?
	private var lastCheckAt: Date?

	init(
		appcastFetcher: AppcastFetchable = AppcastFetcher(),
		nativeUpdater: NativeAppUpdating = SparkleNativeAppUpdater()
	) {
		self.appcastFetcher = appcastFetcher
		self.nativeUpdater = nativeUpdater
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
		if let lastCheckAt, Date().timeIntervalSince(lastCheckAt) < 60 {
			return
		}
		lastCheckAt = Date()

		do {
			guard let latest = try await appcastFetcher.fetchLatestVersion() else { return }
			latestVersion = latest.hasPrefix("v") ? String(latest.dropFirst()) : latest
			isUpdateAvailable = UpdateStore.isVersionNewer(latestVersion ?? latest, currentVersion)
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
