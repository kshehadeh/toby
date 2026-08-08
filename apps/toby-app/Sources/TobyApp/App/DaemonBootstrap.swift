import Foundation

enum DaemonBootstrapError: LocalizedError {
	case tobyExecutableNotFound
	case startFailed(String)
	case serverUnavailable
	case restartUnavailable
	case stopUnavailable
	case identityMismatch(String)

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
		case .identityMismatch(let detail):
			return "Toby server did not match this app after restart (\(detail))."
		}
	}
}

struct DaemonStartCommand: Equatable {
	let executableURL: URL
	let arguments: [String]
	let currentDirectoryURL: URL?
}

/// Progress updates during bootstrap / restart (user-visible status text).
typealias DaemonBootstrapProgress = @Sendable (String) -> Void

enum DaemonBootstrap {
	// MARK: - Public entry points

	static func restartServer(
		baseURL: URL,
		onProgress: DaemonBootstrapProgress? = nil,
	) async throws {
		log("restart.start baseURL=\(baseURL.absoluteString)")
		progress(onProgress, "Stopping server…")
		try await stopRunningServer(baseURL: baseURL, onProgress: onProgress)

		progress(onProgress, "Starting server…")
		let command = try resolvePreferredDaemonStartCommand()
		log("restart.startCommand=\(command.logDescription)")
		try await runDaemonStart(command: command)
		log("restart.startCommandReturned")

		progress(onProgress, "Waiting for server…")
		try await waitForServerAvailable(baseURL: baseURL, timeout: 12, error: .restartUnavailable)

		progress(onProgress, "Verifying server…")
		try await verifyPreferredServer(baseURL: baseURL, onProgress: onProgress)
		log("restart.available")
		progress(onProgress, "Server ready")
	}

	/// Stops the running daemon server and waits for it to become unavailable.
	/// Used before app relaunch (e.g. Sparkle update) to ensure a clean shutdown.
	static func stopDaemon(baseURL: URL) async throws {
		log("stop.start baseURL=\(baseURL.absoluteString)")
		try await stopRunningServer(baseURL: baseURL, onProgress: nil)
		log("stop.serverUnavailable")
	}

	static func ensureServerAvailable(
		baseURL: URL,
		onProgress: DaemonBootstrapProgress? = nil,
	) async throws {
		log("ensure.start baseURL=\(baseURL.absoluteString)")
		progress(onProgress, "Checking server…")

		let preferred = preferredDaemonIdentity()
		log(
			"ensure.preferred executable=\(preferred.executablePath ?? "<nil>") version=\(preferred.version ?? "<nil>") kind=\(preferred.execKind ?? "<nil>")"
		)

		if await isServerAvailable(baseURL: baseURL) {
			let running = await fetchDaemonIdentity(baseURL: baseURL)
			log(
				"ensure.running executable=\(running.executablePath ?? "<nil>") version=\(running.version ?? "<nil>") kind=\(running.execKind ?? "<nil>")"
			)

			if !shouldReplaceServer(
				runningExecutablePath: running.executablePath,
				runningVersion: running.version,
				runningTobyDir: running.tobyDir,
				runningExecKind: running.execKind,
				bundledExecutable: preferred.executableURL,
				bundledVersion: preferred.version,
				expectedExecKind: preferred.execKind,
			) {
				log("ensure.keepRunning")
				progress(onProgress, "Server ready")
				return
			}

			progress(onProgress, "Replacing mismatched server…")
			log("ensure.replace reason=identityMismatch")
			try await stopRunningServer(baseURL: baseURL, onProgress: onProgress)
		} else {
			progress(onProgress, "Starting server…")
		}

		let command = try resolvePreferredDaemonStartCommand()
		log("ensure.startCommand=\(command.logDescription)")
		try await runDaemonStart(command: command)
		log("ensure.startCommandReturned")

		progress(onProgress, "Waiting for server…")
		try await waitForServerAvailable(baseURL: baseURL, timeout: 12, error: .serverUnavailable)

		progress(onProgress, "Verifying server…")
		try await verifyPreferredServer(baseURL: baseURL, onProgress: onProgress, allowReplaceRetry: true)
		log("ensure.available")
		progress(onProgress, "Server ready")
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

	// MARK: - Match rules

	static func shouldReplaceServer(
		runningExecutablePath: String?,
		runningVersion: String?,
		runningTobyDir: String? = nil,
		runningExecKind: String? = nil,
		bundledExecutable: URL? = nil,
		bundledVersion: String? = nil,
		expectedExecKind: String? = nil,
		expectedTobyDir: String? = nil,
	) -> Bool {
		// Always verify the running daemon uses this app's expected data root
		// when the daemon reports a tobyDir (modern health/status payloads).
		let expectedDir = (expectedTobyDir ?? ConfigReader.resolveTobyDir())
			.trimmingCharacters(in: .whitespacesAndNewlines)
		if !expectedDir.isEmpty,
			let running = runningTobyDir?.trimmingCharacters(in: .whitespacesAndNewlines),
			!running.isEmpty
		{
			if ConfigReader.standardizePath(running) != ConfigReader.standardizePath(expectedDir) {
				return true
			}
		}

		if let expectedExecKind = expectedExecKind?.trimmingCharacters(in: .whitespacesAndNewlines),
			!expectedExecKind.isEmpty
		{
			let running = runningExecKind?.trimmingCharacters(in: .whitespacesAndNewlines)
			if running != expectedExecKind {
				return true
			}
		}

		guard let bundledExecutable = bundledExecutable else {
			// No preferred executable (unusual). Keep whatever is running unless version is known and mismatches.
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
			return normalizeVersion(runningVersion) != normalizeVersion(bundledVersion)
		}

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

		return normalizeVersion(runningVersion) != normalizeVersion(bundledVersion)
	}

	// MARK: - Preferred identity / start command

	/// Whether this app build includes a bundled CLI (production / self-contained).
	static func hasBundledTobyExecutable() -> Bool {
		bundledTobyExecutable() != nil
	}

	/// Prefer bundled binary for production; only use monorepo source when no bundle is present.
	static func resolvePreferredDaemonStartCommand() throws -> DaemonStartCommand {
		if let bundled = bundledTobyExecutable() {
			return compiledDaemonStartCommand(executable: bundled)
		}
		return try resolveDaemonStartCommand(preferDevSource: true)
	}

	static func preferredDaemonIdentity() -> PreferredDaemonIdentity {
		if let bundled = bundledTobyExecutable() {
			return PreferredDaemonIdentity(
				executableURL: bundled,
				executablePath: bundled.normalizedExecutablePath,
				version: bundledAppVersion(),
				execKind: "compiled"
			)
		}

		// Dev: resolve identity path (entry script or compiled CLI), not the bun host binary.
		if let command = try? resolveDaemonStartCommand(preferDevSource: true) {
			let identityURL: URL
			let kind: String
			if let script = command.arguments.first(where: {
				$0.hasSuffix(".ts") || $0.hasSuffix(".js") || $0.hasSuffix(".mjs") || $0.hasSuffix(".cjs")
			}) {
				identityURL = URL(fileURLWithPath: script)
				kind = "source"
			} else if command.arguments == ["daemon", "start"] {
				identityURL = command.executableURL
				kind = "compiled"
			} else {
				// Fallback: compare against the start executable (may be bun); kind still source.
				identityURL = command.executableURL
				kind = "source"
			}
			return PreferredDaemonIdentity(
				executableURL: identityURL,
				executablePath: identityURL.normalizedExecutablePath,
				version: bundledAppVersion(),
				execKind: kind
			)
		}

		return PreferredDaemonIdentity(
			executableURL: nil,
			executablePath: nil,
			version: bundledAppVersion(),
			execKind: nil
		)
	}

	// MARK: - Identity fetch / verify

	private static func verifyPreferredServer(
		baseURL: URL,
		onProgress: DaemonBootstrapProgress?,
		allowReplaceRetry: Bool = false,
	) async throws {
		let preferred = preferredDaemonIdentity()
		let running = await fetchDaemonIdentity(baseURL: baseURL)
		let needsReplace = shouldReplaceServer(
			runningExecutablePath: running.executablePath,
			runningVersion: running.version,
			runningTobyDir: running.tobyDir,
			runningExecKind: running.execKind,
			bundledExecutable: preferred.executableURL,
			bundledVersion: preferred.version,
			expectedExecKind: preferred.execKind,
		)

		if !needsReplace {
			return
		}

		let detail = identityMismatchDetail(preferred: preferred, running: running)
		log("verify.mismatch \(detail)")

		guard allowReplaceRetry else {
			throw DaemonBootstrapError.identityMismatch(detail)
		}

		// Common race: `daemon start` no-ops when an old process still holds the lock.
		progress(onProgress, "Retrying with the correct server…")
		try await stopRunningServer(baseURL: baseURL, onProgress: onProgress, force: true)

		let command = try resolvePreferredDaemonStartCommand()
		try await runDaemonStart(command: command)
		try await waitForServerAvailable(baseURL: baseURL, timeout: 12, error: .serverUnavailable)

		let after = await fetchDaemonIdentity(baseURL: baseURL)
		if shouldReplaceServer(
			runningExecutablePath: after.executablePath,
			runningVersion: after.version,
			runningTobyDir: after.tobyDir,
			runningExecKind: after.execKind,
			bundledExecutable: preferred.executableURL,
			bundledVersion: preferred.version,
			expectedExecKind: preferred.execKind,
		) {
			throw DaemonBootstrapError.identityMismatch(
				identityMismatchDetail(preferred: preferred, running: after)
			)
		}
	}

	private static func identityMismatchDetail(
		preferred: PreferredDaemonIdentity,
		running: DaemonIdentity,
	) -> String {
		var parts: [String] = []
		if let expected = preferred.executablePath {
			parts.append("expected \(expected)")
		}
		if let actual = running.executablePath {
			parts.append("got \(actual)")
		}
		if let expectedVersion = preferred.version, let actualVersion = running.version,
			normalizeVersion(expectedVersion) != normalizeVersion(actualVersion)
		{
			parts.append("version \(actualVersion) ≠ \(expectedVersion)")
		}
		if let expectedKind = preferred.execKind, let actualKind = running.execKind,
			expectedKind != actualKind
		{
			parts.append("kind \(actualKind) ≠ \(expectedKind)")
		}
		return parts.isEmpty ? "identity mismatch" : parts.joined(separator: "; ")
	}

	private static func fetchDaemonIdentity(baseURL: URL) async -> DaemonIdentity {
		// Prefer unified /api/health identity when available.
		if let fromHealth = await fetchIdentityFromHealth(baseURL: baseURL) {
			return fromHealth
		}

		async let executablePath = fetchRunningDaemonExecutablePath(baseURL: baseURL)
		async let version = fetchRunningServerVersion(baseURL: baseURL)
		async let tobyDir = fetchRunningTobyDir(baseURL: baseURL)
		async let execKind = fetchRunningExecKind(baseURL: baseURL)
		return await DaemonIdentity(
			executablePath: executablePath,
			version: version,
			tobyDir: tobyDir,
			execKind: execKind,
			pid: nil
		)
	}

	private static func fetchIdentityFromHealth(baseURL: URL) async -> DaemonIdentity? {
		do {
			let payload = try await fetchJSON(baseURL.appendingPathComponent("api/health"))
			guard let identity = payload?["identity"] as? [String: Any] else {
				return nil
			}
			return DaemonIdentity(
				executablePath: identity["executablePath"] as? String,
				version: identity["version"] as? String,
				tobyDir: identity["tobyDir"] as? String,
				execKind: identity["execKind"] as? String,
				pid: identity["pid"] as? Int
			)
		} catch {
			return nil
		}
	}

	private static func isServerAvailable(baseURL: URL) async -> Bool {
		// Prefer health (cheap + carries identity on modern daemons).
		var healthRequest = URLRequest(url: baseURL.appendingPathComponent("api/health"))
		healthRequest.timeoutInterval = 1
		do {
			let (_, response) = try await URLSession.shared.data(for: healthRequest)
			if let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) {
				return true
			}
		} catch {
			// fall through to status
		}

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

	private static func fetchRunningDaemonExecutablePath(baseURL: URL) async -> String? {
		do {
			let payload = try await fetchJSON(baseURL.appendingPathComponent("api/daemon/status"))
			let process = payload?["process"] as? [String: Any]
			return process?["executablePath"] as? String
		} catch {
			return nil
		}
	}

	private static func fetchRunningExecKind(baseURL: URL) async -> String? {
		do {
			let payload = try await fetchJSON(baseURL.appendingPathComponent("api/daemon/status"))
			let process = payload?["process"] as? [String: Any]
			return process?["execKind"] as? String
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

	private static func fetchRunningTobyDir(baseURL: URL) async -> String? {
		do {
			let payload = try await fetchJSON(baseURL.appendingPathComponent("api/status"))
			return payload?["tobyDir"] as? String
		} catch {
			return nil
		}
	}

	private static func fetchJSON(_ url: URL) async throws -> [String: Any]? {
		var request = URLRequest(url: url)
		request.timeoutInterval = 1
		request.cachePolicy = .reloadIgnoringLocalCacheData

		let (data, response) = try await URLSession.shared.data(for: request)
		guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
			return nil
		}
		return try JSONSerialization.jsonObject(with: data) as? [String: Any]
	}

	// MARK: - Stop / force kill

	private static func stopRunningServer(
		baseURL: URL,
		onProgress: DaemonBootstrapProgress?,
		force: Bool = false,
	) async throws {
		let lockPid = readDaemonLockPid()

		if await isServerAvailable(baseURL: baseURL) {
			progress(onProgress, "Stopping server…")
			do {
				try await requestDaemonStop(baseURL: baseURL)
				log("stop.httpRequested")
			} catch {
				log("stop.httpFailed error=\(error.localizedDescription)")
				if !force {
					// Fall through to lock-based kill.
				}
			}
		}

		// Prefer waiting for HTTP to go down, then ensure the process is gone.
		try? await waitForServerUnavailable(baseURL: baseURL, timeout: 6)

		let pidToKill = lockPid ?? readDaemonLockPid()
		if let pid = pidToKill, isProcessAlive(pid: pid) {
			log("stop.forceKill pid=\(pid)")
			progress(onProgress, "Stopping leftover server process…")
			signalProcess(pid: pid, signal: SIGTERM)
			if !(await waitForProcessExit(pid: pid, timeout: 4)) {
				log("stop.sigkill pid=\(pid)")
				signalProcess(pid: pid, signal: SIGKILL)
				_ = await waitForProcessExit(pid: pid, timeout: 2)
			}
		}

		// Best-effort remove stale lock so the next start is not a no-op.
		removeDaemonLockIfStale()

		if await isServerAvailable(baseURL: baseURL) {
			// One more hard attempt if something is still answering.
			if let pid = readDaemonLockPid() ?? lockPid {
				signalProcess(pid: pid, signal: SIGKILL)
				_ = await waitForProcessExit(pid: pid, timeout: 2)
			}
			try await waitForServerUnavailable(baseURL: baseURL, timeout: 4)
		}

		if await isServerAvailable(baseURL: baseURL) {
			throw DaemonBootstrapError.stopUnavailable
		}
		log("stop.done")
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

	private static func readDaemonLockPid() -> Int32? {
		let lockPath = (ConfigReader.resolveTobyDir() as NSString).appendingPathComponent("daemon.lock")
		guard let raw = try? String(contentsOfFile: lockPath, encoding: .utf8) else {
			return nil
		}
		let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		if let legacy = Int32(trimmed), legacy > 0 {
			return legacy
		}
		guard
			let data = trimmed.data(using: .utf8),
			let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
		else {
			return nil
		}
		if let pid = json["pid"] as? Int, pid > 0 {
			return Int32(pid)
		}
		if let pid = json["pid"] as? Int32, pid > 0 {
			return pid
		}
		return nil
	}

	private static func removeDaemonLockIfStale() {
		guard let pid = readDaemonLockPid() else {
			// No parseable PID; leave file alone unless process check fails later.
			return
		}
		if isProcessAlive(pid: pid) {
			return
		}
		let lockPath = (ConfigReader.resolveTobyDir() as NSString).appendingPathComponent("daemon.lock")
		try? FileManager.default.removeItem(atPath: lockPath)
		log("stop.removedStaleLock pid=\(pid)")
	}

	private static func isProcessAlive(pid: Int32) -> Bool {
		if pid <= 0 { return false }
		return kill(pid, 0) == 0
	}

	private static func signalProcess(pid: Int32, signal: Int32) {
		_ = kill(pid, signal)
	}

	private static func waitForProcessExit(pid: Int32, timeout: TimeInterval) async -> Bool {
		let deadline = Date().addingTimeInterval(timeout)
		while Date() < deadline {
			if !isProcessAlive(pid: pid) {
				return true
			}
			try? await Task.sleep(nanoseconds: 150_000_000)
		}
		return !isProcessAlive(pid: pid)
	}

	// MARK: - Start process

	private static func runDaemonStart(command: DaemonStartCommand) async throws {
		log("runStart.start command=\(command.logDescription)")
		let tobyDir = ConfigReader.resolveTobyDir()
		try await Task.detached(priority: .userInitiated) {
			let process = Process()
			process.executableURL = command.executableURL
			process.arguments = command.arguments
			process.currentDirectoryURL = command.currentDirectoryURL

			// Ensure the child uses the app's resolved data root even when the
			// preference was applied mid-session (do not rely only on inheritance).
			var environment = ProcessInfo.processInfo.environment
			environment["TOBY_DIR"] = tobyDir
			process.environment = environment

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
		// Bun resolves workspace packages (@toby/core) from the package that
		// owns the entry script. Running with the monorepo root as cwd fails
		// with "Cannot find module '@toby/core/...'"; apps/cli is the package
		// that depends on @toby/core (matches `bun run --cwd apps/cli dev`).
		let cliPackageRoot = repoRoot.appendingPathComponent("apps/cli")
		return sourceCliCandidates(repoRoot: repoRoot).flatMap { cliURL in
			bunExecutableCandidates(repoRoot: repoRoot).map { bunCandidate in
				var arguments = bunCandidate.argumentPrefix
				arguments.append(cliURL.path)
				arguments.append(contentsOf: ["daemon", "start"])
				return DaemonStartCommand(
					executableURL: bunCandidate.executableURL,
					arguments: arguments,
					currentDirectoryURL: cliPackageRoot
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

	private static func normalizeVersion(_ version: String) -> String {
		let trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed.hasPrefix("v") || trimmed.hasPrefix("V") {
			return String(trimmed.dropFirst())
		}
		return trimmed
	}

	private static func progress(_ handler: DaemonBootstrapProgress?, _ message: String) {
		handler?(message)
	}

	private static func log(_ message: String) {
		ServerEventLog.append("daemonBootstrap.\(message)")
	}
}

// MARK: - Supporting types

struct PreferredDaemonIdentity: Equatable {
	let executableURL: URL?
	let executablePath: String?
	let version: String?
	let execKind: String?
}

private struct BunExecutableCandidate: Equatable {
	let executableURL: URL
	let argumentPrefix: [String]
}

private struct DaemonIdentity {
	let executablePath: String?
	let version: String?
	let tobyDir: String?
	let execKind: String?
	let pid: Int?
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
