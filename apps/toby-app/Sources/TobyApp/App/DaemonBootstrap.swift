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
			return "Toby server is not running, and neither the Toby CLI nor a Bun source CLI could be found. Install Toby or set TOBY_CLI to the CLI path."
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

struct DaemonStartCommand: Equatable {
	let executableURL: URL
	let arguments: [String]
	let currentDirectoryURL: URL?
}

enum DaemonBootstrap {
	static func restartServer(baseURL: URL) async throws {
		log("restart.start baseURL=\(baseURL.absoluteString)")
		try await requestDaemonStop(baseURL: baseURL)
		log("restart.stopRequested")
		try await waitForServerUnavailable(baseURL: baseURL, timeout: 6)
		log("restart.serverUnavailable")
		let command = try resolveDaemonStartCommand(preferDevSource: true)
		try await runDaemonStart(command: command)
		log("restart.startCommandReturned")
		try await waitForServerAvailable(baseURL: baseURL, timeout: 10, error: .restartUnavailable)
		log("restart.available")
	}

	/// Stops the running daemon server and waits for it to become unavailable.
	/// Used before app relaunch (e.g. Sparkle update) to ensure a clean shutdown.
	static func stopDaemon(baseURL: URL) async throws {
		log("stop.start baseURL=\(baseURL.absoluteString)")
		try await requestDaemonStop(baseURL: baseURL)
		log("stop.stopRequested")
		try await waitForServerUnavailable(baseURL: baseURL, timeout: 6)
		log("stop.serverUnavailable")
	}

	static func ensureServerAvailable(baseURL: URL) async throws {
		log("ensure.start baseURL=\(baseURL.absoluteString)")
		if let bundledExecutable = bundledTobyExecutable() {
			try await ensureBundledServerAvailable(
				baseURL: baseURL,
				bundledExecutable: bundledExecutable
			)
			log("ensure.bundled.done")
			return
		}

		if await isServerAvailable(baseURL: baseURL) {
			log("ensure.available")
			return
		}

		let command = try resolveDaemonStartCommand(preferDevSource: true)
		try await runDaemonStart(command: command)
		log("ensure.startCommandReturned")

		try await waitForServerAvailable(baseURL: baseURL, timeout: 6, error: .serverUnavailable)
		log("ensure.availableAfterStart")
	}

	static func waitForServerAvailable(
		baseURL: URL,
		timeout: TimeInterval,
		error: DaemonBootstrapError,
	) async throws {
		log("wait.available.start timeout=\(timeout) baseURL=\(baseURL.absoluteString)")
		let deadline = Date().addingTimeInterval(timeout)
		while Date() < deadline {
			if await isServerAvailable(baseURL: baseURL) {
				log("wait.available.success")
				return
			}
			try await Task.sleep(nanoseconds: 300_000_000)
		}

		log("wait.available.timeout")
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
		log("ensureBundled.start executable=\(bundledExecutable.path)")
		guard await isServerAvailable(baseURL: baseURL) else {
			try await runDaemonStart(command: compiledDaemonStartCommand(executable: bundledExecutable))
			try await waitForServerAvailable(baseURL: baseURL, timeout: 6, error: .serverUnavailable)
			log("ensureBundled.started")
			return
		}

		let runningInfo = await fetchRunningServerInfo(baseURL: baseURL)
		log("ensureBundled.running executable=\(runningInfo.executablePath ?? "<nil>") version=\(runningInfo.version ?? "<nil>")")
		guard shouldReplaceServer(
			runningExecutablePath: runningInfo.executablePath,
			runningVersion: runningInfo.version,
			bundledExecutable: bundledExecutable,
			bundledVersion: bundledAppVersion()
		) else {
			log("ensureBundled.keepRunning")
			return
		}

		log("ensureBundled.replace")
		try await requestDaemonStop(baseURL: baseURL)
		try await waitForServerUnavailable(baseURL: baseURL, timeout: 6)
		try await runDaemonStart(command: compiledDaemonStartCommand(executable: bundledExecutable))
		try await waitForServerAvailable(baseURL: baseURL, timeout: 10, error: .serverUnavailable)
		log("ensureBundled.replaced")
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
		log("requestStop.start")
		var request = URLRequest(url: baseURL.appendingPathComponent("api/daemon/stop"))
		request.httpMethod = "POST"
		request.timeoutInterval = 2
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = Data("{}".utf8)

		do {
			let (_, response) = try await URLSession.shared.data(for: request)
			guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
				log("requestStop.invalidResponse")
				throw DaemonBootstrapError.stopUnavailable
			}
			log("requestStop.success")
		} catch {
			log("requestStop.failed error=\(error.localizedDescription)")
			throw DaemonBootstrapError.stopUnavailable
		}
	}

	private static func waitForServerUnavailable(baseURL: URL, timeout: TimeInterval) async throws {
		log("wait.unavailable.start timeout=\(timeout) baseURL=\(baseURL.absoluteString)")
		let deadline = Date().addingTimeInterval(timeout)
		while Date() < deadline {
			if !(await isServerAvailable(baseURL: baseURL)) {
				log("wait.unavailable.success")
				return
			}
			try await Task.sleep(nanoseconds: 300_000_000)
		}

		log("wait.unavailable.timeout")
		throw DaemonBootstrapError.stopUnavailable
	}

	private static func runDaemonStart(command: DaemonStartCommand) async throws {
		log("runStart.start command=\(command.logDescription)")
		try await Task.detached(priority: .userInitiated) {
			let process = Process()
			process.executableURL = command.executableURL
			process.arguments = command.arguments
			process.currentDirectoryURL = command.currentDirectoryURL

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
		log("runStart.success command=\(command.logDescription)")
	}

	static func daemonStartCommands(preferDevSource: Bool = false) -> [DaemonStartCommand] {
		var commands: [DaemonStartCommand] = []

		if preferDevSource {
			for repoRoot in devRepoRootCandidates() {
				commands.append(contentsOf: sourceDaemonStartCommands(repoRoot: repoRoot))
			}
		}

		commands.append(
			contentsOf: executableCandidates(preferCurrentDirectory: preferDevSource)
				.map(compiledDaemonStartCommand)
		)

		return commands.uniquedBySignature()
	}

	static func executableCandidates(preferCurrentDirectory: Bool = false) -> [URL] {
		let home = FileManager.default.homeDirectoryForCurrentUser
		var candidates: [URL] = []

		if preferCurrentDirectory {
			let currentDirectory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
			candidates.append(currentDirectory.appendingPathComponent("toby"))
			candidates.append(currentDirectory.appendingPathComponent("dist/toby"))
			if let devDistCli = devDistTobyExecutable() {
				candidates.append(devDistCli)
			}
		}

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

	private static func resolveDaemonStartCommand(preferDevSource: Bool) throws -> DaemonStartCommand {
		for command in daemonStartCommands(preferDevSource: preferDevSource) {
			if FileManager.default.isExecutableFile(atPath: command.executableURL.path) {
				return command
			}
		}
		throw DaemonBootstrapError.tobyExecutableNotFound
	}

	private static func compiledDaemonStartCommand(executable: URL) -> DaemonStartCommand {
		DaemonStartCommand(
			executableURL: executable,
			arguments: ["daemon", "start"],
			currentDirectoryURL: nil
		)
	}

	private static func sourceDaemonStartCommands(repoRoot: URL) -> [DaemonStartCommand] {
		sourceCliCandidates(repoRoot: repoRoot).flatMap { cliURL in
			bunExecutableCandidates(repoRoot: repoRoot).map { bunCandidate in
				var arguments = bunCandidate.argumentPrefix
				arguments.append(cliURL.path)
				arguments.append(contentsOf: ["daemon", "start"])
				return DaemonStartCommand(
					executableURL: bunCandidate.executableURL,
					arguments: arguments,
					currentDirectoryURL: repoRoot
				)
			}
		}
	}

	private static func sourceCliCandidates(repoRoot: URL) -> [URL] {
		[
			repoRoot.appendingPathComponent("apps/cli/cli.ts"),
			repoRoot.appendingPathComponent("apps/cli/src/cli.ts"),
		]
		.filter { FileManager.default.fileExists(atPath: $0.path) }
	}

	private static func bunExecutableCandidates(repoRoot: URL) -> [BunExecutableCandidate] {
		let home = FileManager.default.homeDirectoryForCurrentUser
		var candidates: [BunExecutableCandidate] = []

		if let explicit = ProcessInfo.processInfo.environment["TOBY_BUN_PATH"]?.trimmingCharacters(in: .whitespacesAndNewlines),
			!explicit.isEmpty
		{
			candidates.append(BunExecutableCandidate(executableURL: URL(fileURLWithPath: explicit), argumentPrefix: []))
		}

		if let resourceURL = Bundle.main.resourceURL {
			candidates.append(BunExecutableCandidate(executableURL: resourceURL.appendingPathComponent("bun"), argumentPrefix: []))
		}

		candidates.append(BunExecutableCandidate(executableURL: repoRoot.appendingPathComponent("dist/bun"), argumentPrefix: []))
		candidates.append(BunExecutableCandidate(executableURL: home.appendingPathComponent(".bun/bin/bun"), argumentPrefix: []))
		candidates.append(BunExecutableCandidate(executableURL: URL(fileURLWithPath: "/opt/homebrew/bin/bun"), argumentPrefix: []))
		candidates.append(BunExecutableCandidate(executableURL: URL(fileURLWithPath: "/usr/local/bin/bun"), argumentPrefix: []))
		candidates.append(contentsOf: pathExecutableCandidates(named: "bun").map {
			BunExecutableCandidate(executableURL: $0, argumentPrefix: [])
		})

		return candidates.uniquedBySignature()
	}

	private static func pathExecutableCandidates(named executableName: String) -> [URL] {
		let pathValue = ProcessInfo.processInfo.environment["PATH"] ?? ""
		return pathValue
			.split(separator: ":")
			.map { URL(fileURLWithPath: String($0)).appendingPathComponent(executableName) }
			.filter { FileManager.default.isExecutableFile(atPath: $0.path) }
	}

	private static func devRepoRootCandidates() -> [URL] {
		var candidates: [URL] = []

		var current = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
		for _ in 0 ..< 6 {
			candidates.append(current)
			let parent = current.deletingLastPathComponent()
			if parent == current {
				break
			}
			current = parent
		}

		let bundleParent = Bundle.main.bundleURL.standardizedFileURL.deletingLastPathComponent()
		if bundleParent.lastPathComponent == "dist" {
			candidates.append(bundleParent.deletingLastPathComponent())
		}

		return candidates.uniquedByPath()
	}

	private static func bundledTobyExecutable() -> URL? {
		guard let resourceURL = Bundle.main.resourceURL else { return nil }
		let candidate = resourceURL.appendingPathComponent("toby")
		return FileManager.default.isExecutableFile(atPath: candidate.path) ? candidate : nil
	}

	private static func bundledAppVersion() -> String? {
		Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
	}

	private static func devDistTobyExecutable() -> URL? {
		let parent = Bundle.main.bundleURL.standardizedFileURL.deletingLastPathComponent()
		guard parent.lastPathComponent == "dist" else {
			return nil
		}
		return parent.appendingPathComponent("toby")
	}

	private static func log(_ message: String) {
		ServerEventLog.append("daemonBootstrap.\(message)")
	}

}

private struct BunExecutableCandidate: Equatable {
	let executableURL: URL
	let argumentPrefix: [String]
}

private struct RunningServerInfo {
	let executablePath: String?
	let version: String?
}

private extension DaemonStartCommand {
	var logDescription: String {
		([executableURL.path] + arguments).joined(separator: " ")
	}
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

private extension Array where Element == BunExecutableCandidate {
	func uniquedBySignature() -> [BunExecutableCandidate] {
		var seen = Set<String>()
		return filter { candidate in
			let key = ([candidate.executableURL.standardizedFileURL.path] + candidate.argumentPrefix).joined(separator: "\u{0}")
			return seen.insert(key).inserted
		}
	}
}

private extension Array where Element == DaemonStartCommand {
	func uniquedBySignature() -> [DaemonStartCommand] {
		var seen = Set<String>()
		return filter { command in
			let key = (
				[command.executableURL.standardizedFileURL.path]
					+ command.arguments
					+ [command.currentDirectoryURL?.standardizedFileURL.path ?? ""]
			).joined(separator: "\u{0}")
			return seen.insert(key).inserted
		}
	}
}
