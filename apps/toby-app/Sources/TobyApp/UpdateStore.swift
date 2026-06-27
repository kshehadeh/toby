import AppKit
import Foundation
import Observation

@Observable
@MainActor
final class UpdateStore {
	var latestVersion: String?
	var isUpdateAvailable = false
	var isUpgrading = false
	var upgradeError: String?
	var upgradeComplete = false

	private let client: ChangelogFetchable
	private var checkTask: Task<Void, Never>?
	private var lastCheckAt: Date?

	init(client: ChangelogFetchable = TobyClient()) {
		self.client = client
	}

	func startCheckLoop(currentVersionProvider: @escaping () -> String?) {
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
			latestVersion = latest.version
			isUpdateAvailable = UpdateStore.isVersionNewer(latest.version, currentVersion)
		} catch {
			// Silently ignore update check failures
		}
	}

	func performUpgrade() async {
		guard isUpdateAvailable, !isUpgrading else { return }
		isUpgrading = true
		upgradeError = nil
		upgradeComplete = false
		defer { isUpgrading = false }

		guard let tobyBin = findTobyBinary() else {
			upgradeError = "Could not find the toby binary. Make sure Toby is installed properly."
			return
		}

		let result: (Int32, String) = await withCheckedContinuation { continuation in
			DispatchQueue.global().async {
				let process = Process()
				process.executableURL = URL(fileURLWithPath: tobyBin)
				process.arguments = ["upgrade"]
				let pipe = Pipe()
				process.standardOutput = pipe
				process.standardError = pipe
				do {
					try process.run()
					process.waitUntilExit()
					let data = pipe.fileHandleForReading.readDataToEndOfFile()
					let output = String(data: data, encoding: .utf8) ?? ""
					continuation.resume(returning: (process.terminationStatus, output))
				} catch {
					continuation.resume(returning: (-1, error.localizedDescription))
				}
			}
		}

		if result.0 == 0 {
			upgradeComplete = true
			isUpdateAvailable = false
		} else {
			let cleaned = result.1
				.replacingOccurrences(of: "\u{1B}", with: "")
				.replacingOccurrences(of: "\r", with: "\n")
				.components(separatedBy: "\n")
				.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
				.joined(separator: "\n")
			upgradeError = cleaned.isEmpty ? "Upgrade failed with exit code \(result.0)." : cleaned
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

	private func findTobyBinary() -> String? {
		let home = FileManager.default.homeDirectoryForCurrentUser
		let candidates = [
			home.appendingPathComponent(".local/bin/toby").path,
			"/usr/local/bin/toby",
			"/opt/homebrew/bin/toby",
		]
		for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
			return candidate
		}
		// Fallback: use `which toby`
		let whichProcess = Process()
		whichProcess.executableURL = URL(fileURLWithPath: "/usr/bin/which")
		whichProcess.arguments = ["toby"]
		let pipe = Pipe()
		whichProcess.standardOutput = pipe
		whichProcess.standardError = Pipe()
		do {
			try whichProcess.run()
			whichProcess.waitUntilExit()
			let data = pipe.fileHandleForReading.readDataToEndOfFile()
			let path = String(data: data, encoding: .utf8)?
				.trimmingCharacters(in: .whitespacesAndNewlines)
			if let path, !path.isEmpty, FileManager.default.isExecutableFile(atPath: path) {
				return path
			}
		} catch {
			// ignore
		}
		return nil
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
