import Foundation

enum DaemonBootstrapError: LocalizedError {
	case tobyExecutableNotFound
	case startFailed(String)
	case serverUnavailable
	case restartUnavailable

	var errorDescription: String? {
		switch self {
		case .tobyExecutableNotFound:
			return "Toby server is not running, and the `toby` command could not be found. Install Toby or set TOBY_CLI to the CLI path."
		case .startFailed(let message):
			return "Failed to start Toby server: \(message)"
		case .serverUnavailable:
			return "Toby server did not become available after starting."
		case .restartUnavailable:
			return "Toby server did not become available after restarting."
		}
	}
}

enum DaemonBootstrap {
	static func ensureServerAvailable(baseURL: URL) async throws {
		if await isServerAvailable(baseURL: baseURL) {
			return
		}

		let executable = try resolveTobyExecutable()
		try await runDaemonStart(executable: executable)

		try await waitForServerAvailable(baseURL: baseURL, timeout: 6, error: .serverUnavailable)
	}

	static func waitForServerAvailable(
		baseURL: URL,
		timeout: TimeInterval,
		error: DaemonBootstrapError,
	) async throws {
		let deadline = Date().addingTimeInterval(timeout)
		while Date() < deadline {
			if await isServerAvailable(baseURL: baseURL) {
				return
			}
			try await Task.sleep(nanoseconds: 300_000_000)
		}

		throw error
	}

	private static func isServerAvailable(baseURL: URL) async -> Bool {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/status"))
		request.timeoutInterval = 1

		do {
			let (_, response) = try await URLSession.shared.data(for: request)
			guard let http = response as? HTTPURLResponse else {
				return false
			}
			return (200 ... 299).contains(http.statusCode)
		} catch {
			return false
		}
	}

	private static func runDaemonStart(executable: URL) async throws {
		try await Task.detached(priority: .userInitiated) {
			let process = Process()
			process.executableURL = executable
			process.arguments = ["daemon", "start"]

			let outputPipe = Pipe()
			process.standardOutput = outputPipe
			process.standardError = outputPipe

			try process.run()
			process.waitUntilExit()

			guard process.terminationStatus == 0 else {
				let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
				let output = String(data: data, encoding: .utf8)?
					.trimmingCharacters(in: .whitespacesAndNewlines)
				throw DaemonBootstrapError.startFailed(output?.isEmpty == false ? output! : "exit code \(process.terminationStatus)")
			}
		}.value
	}

	private static func resolveTobyExecutable() throws -> URL {
		for candidate in executableCandidates() {
			if FileManager.default.isExecutableFile(atPath: candidate.path) {
				return candidate
			}
		}
		throw DaemonBootstrapError.tobyExecutableNotFound
	}

	private static func executableCandidates() -> [URL] {
		let home = FileManager.default.homeDirectoryForCurrentUser
		var candidates: [URL] = []

		if let explicit = ProcessInfo.processInfo.environment["TOBY_CLI"]?.trimmingCharacters(in: .whitespacesAndNewlines), !explicit.isEmpty {
			candidates.append(URL(fileURLWithPath: explicit))
		}

		// Self-contained app: CLI bundled inside Contents/Resources/
		if let resourceURL = Bundle.main.resourceURL {
			candidates.append(resourceURL.appendingPathComponent("toby"))
		}

		// Legacy: CLI sitting next to the .app bundle
		if let bundleParent = Bundle.main.bundleURL.deletingLastPathComponentIfAppBundle() {
			candidates.append(bundleParent.appendingPathComponent("toby"))
		}

		candidates.append(home.appendingPathComponent(".local/bin/toby"))
		candidates.append(URL(fileURLWithPath: "/opt/homebrew/bin/toby"))
		candidates.append(URL(fileURLWithPath: "/usr/local/bin/toby"))

		return candidates.uniquedByPath()
	}
}

private extension URL {
	func deletingLastPathComponentIfAppBundle() -> URL? {
		pathExtension == "app" ? deletingLastPathComponent() : nil
	}
}

private extension Array where Element == URL {
	func uniquedByPath() -> [URL] {
		var seen = Set<String>()
		return filter { url in
			seen.insert(url.standardizedFileURL.path).inserted
		}
	}
}
