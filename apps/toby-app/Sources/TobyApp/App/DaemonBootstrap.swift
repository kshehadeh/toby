import Foundation

enum DaemonBootstrapError: LocalizedError {
	case tobyExecutableNotFound
	case startFailed(String)
	case serverUnavailable
	case restartUnavailable
	case stopUnavailable

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
		case .stopUnavailable:
			return "Toby server did not stop."
		}
	}
}

enum DaemonBootstrap {
	static func ensureServerAvailable(baseURL: URL) async throws {
		if let bundledExecutable = bundledTobyExecutable() {
			try await ensureBundledServerAvailable(
				baseURL: baseURL,
				bundledExecutable: bundledExecutable
			)
			return
		}

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

	static func shouldReplaceServer(
		runningExecutablePath: String?,
		runningVersion: String?,
		bundledExecutable: URL,
		bundledVersion: String?,
	) -> Bool {
		guard let runningExecutablePath = runningExecutablePath?.trimmingCharacters(in: .whitespacesAndNewlines),
			!runningExecutablePath.isEmpty
		else {
			return true
		}

		let running = URL(fileURLWithPath: runningExecutablePath).normalizedExecutablePath
		let bundled = bundledExecutable.normalizedExecutablePath
		if running != bundled {
			return true
		}

		guard let bundledVersion = bundledVersion?.trimmingCharacters(in: .whitespacesAndNewlines),
			!bundledVersion.isEmpty
		else {
			return false
		}

		guard let runningVersion = runningVersion?.trimmingCharacters(in: .whitespacesAndNewlines),
			!runningVersion.isEmpty
		else {
			return true
		}

		return runningVersion != bundledVersion
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

	private static func ensureBundledServerAvailable(
		baseURL: URL,
		bundledExecutable: URL,
	) async throws {
		guard await isServerAvailable(baseURL: baseURL) else {
			try await runDaemonStart(executable: bundledExecutable)
			try await waitForServerAvailable(baseURL: baseURL, timeout: 6, error: .serverUnavailable)
			return
		}

		let runningInfo = await fetchRunningServerInfo(baseURL: baseURL)
		guard shouldReplaceServer(
			runningExecutablePath: runningInfo.executablePath,
			runningVersion: runningInfo.version,
			bundledExecutable: bundledExecutable,
			bundledVersion: bundledAppVersion()
		) else {
			return
		}

		try await requestDaemonStop(baseURL: baseURL)
		try await waitForServerUnavailable(baseURL: baseURL, timeout: 6)
		try await runDaemonStart(executable: bundledExecutable)
		try await waitForServerAvailable(baseURL: baseURL, timeout: 10, error: .serverUnavailable)
	}

	private static func fetchRunningServerInfo(baseURL: URL) async -> RunningServerInfo {
		async let executablePath = fetchRunningDaemonExecutablePath(baseURL: baseURL)
		async let version = fetchRunningServerVersion(baseURL: baseURL)
		return await RunningServerInfo(executablePath: executablePath, version: version)
	}

	private static func fetchRunningDaemonExecutablePath(baseURL: URL) async -> String? {
		do {
			let payload = try await fetchJSON(baseURL.appendingPathComponent("api/daemon/status"))
			let process = payload?["process"] as? [String: Any]
			return process?["executablePath"] as? String
		} catch {
			return nil
		}
	}

	private static func fetchRunningServerVersion(baseURL: URL) async -> String? {
		do {
			let payload = try await fetchJSON(baseURL.appendingPathComponent("api/status"))
			return payload?["version"] as? String
		} catch {
			return nil
		}
	}

	private static func fetchJSON(_ url: URL) async throws -> [String: Any]? {
		var request = URLRequest(url: url)
		request.timeoutInterval = 1

		let (data, response) = try await URLSession.shared.data(for: request)
		guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
			return nil
		}
		return try JSONSerialization.jsonObject(with: data) as? [String: Any]
	}

	private static func requestDaemonStop(baseURL: URL) async throws {
		var request = URLRequest(url: baseURL.appendingPathComponent("api/daemon/stop"))
		request.httpMethod = "POST"
		request.timeoutInterval = 2
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = Data("{}".utf8)

		do {
			let (_, response) = try await URLSession.shared.data(for: request)
			guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
				throw DaemonBootstrapError.stopUnavailable
			}
		} catch {
			throw DaemonBootstrapError.stopUnavailable
		}
	}

	private static func waitForServerUnavailable(baseURL: URL, timeout: TimeInterval) async throws {
		let deadline = Date().addingTimeInterval(timeout)
		while Date() < deadline {
			if !(await isServerAvailable(baseURL: baseURL)) {
				return
			}
			try await Task.sleep(nanoseconds: 300_000_000)
		}

		throw DaemonBootstrapError.stopUnavailable
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

	private static func bundledTobyExecutable() -> URL? {
		guard let resourceURL = Bundle.main.resourceURL else { return nil }
		let candidate = resourceURL.appendingPathComponent("toby")
		return FileManager.default.isExecutableFile(atPath: candidate.path) ? candidate : nil
	}

	private static func bundledAppVersion() -> String? {
		Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
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

private struct RunningServerInfo {
	let executablePath: String?
	let version: String?
}

private extension URL {
	func deletingLastPathComponentIfAppBundle() -> URL? {
		pathExtension == "app" ? deletingLastPathComponent() : nil
	}

	var normalizedExecutablePath: String {
		standardizedFileURL.resolvingSymlinksInPath().path
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
