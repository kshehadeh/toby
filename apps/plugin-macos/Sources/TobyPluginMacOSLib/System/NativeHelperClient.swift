import Foundation

/// HTTP client that routes permission-gated operations through Toby.app's native API server.
/// Falls back to in-process calls when Toby.app is not running.
/// If Toby.app is not running, attempts to auto-launch it in the background.
enum NativeHelperClient {
	private static let timeoutInterval: TimeInterval = 30
	private static let launchRetryDelay: TimeInterval = 1
	private static let maxLaunchRetries: Int = 8

	// MARK: - Discovery

	private static func resolveNativePort() -> Int? {
		let home = FileManager.default.homeDirectoryForCurrentUser
		let portFile = home.appendingPathComponent(".toby/native-port")
		guard let data = try? Data(contentsOf: portFile),
			let text = String(data: data, encoding: .utf8),
			let port = Int(text.trimmingCharacters(in: .whitespacesAndNewlines))
		else { return nil }
		return port
	}

	static func isAvailable() -> Bool {
		return checkHealth()
	}

	private static func checkHealth() -> Bool {
		guard let port = resolveNativePort() else { return false }
		let url = URL(string: "http://127.0.0.1:\(port)/api/native/health")!
		var request = URLRequest(url: url)
		request.timeoutInterval = 2
		request.httpMethod = "GET"

		let sem = DispatchSemaphore(value: 0)
		final class HealthResult: @unchecked Sendable { var healthy = false }
		let healthResult = HealthResult()

		let task = URLSession.shared.dataTask(with: request) { _, response, _ in
			if let http = response as? HTTPURLResponse, http.statusCode == 200 {
				healthResult.healthy = true
			}
			sem.signal()
		}
		task.resume()
		sem.wait()
		return healthResult.healthy
	}

	// MARK: - Auto-launch

	/// Attempts to launch Toby.app and waits for the native server to become available.
	/// Returns true if the server is ready after launch, false otherwise.
	@discardableResult
	static func ensureAvailable() -> Bool {
		if isAvailable() { return true }

		guard let appURL = resolveTobyAppPath() else {
			return false
		}

		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
		process.arguments = ["-g", appURL.path]
		process.standardInput = FileHandle.nullDevice
		process.standardOutput = FileHandle.nullDevice
		process.standardError = FileHandle.nullDevice
		do {
			try process.run()
		} catch {
			return false
		}

		// Give Toby.app time to launch and start the native server.
		// open -g returns immediately, so we poll for the port file + health.
		for _ in 0..<maxLaunchRetries {
			Thread.sleep(forTimeInterval: launchRetryDelay)
			if checkHealth() { return true }
		}
		return false
	}

	private static func resolveTobyAppPath() -> URL? {
		let home = FileManager.default.homeDirectoryForCurrentUser

		// 1. Explicit env var
		if let env = ProcessInfo.processInfo.environment["TOBY_APP_PATH"],
			!env.isEmpty, FileManager.default.fileExists(atPath: env)
		{
			return URL(fileURLWithPath: env)
		}

		// 2. Development build (has the native server)
		let devPath = home.appendingPathComponent("dev/karim/toby/dist/Toby.app")
		if FileManager.default.fileExists(atPath: devPath.path) {
			return devPath
		}

		// 3. Installed alongside toby binary
		let installDir = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".local/bin/Toby.app")
		if FileManager.default.fileExists(atPath: installDir.path) {
			return installDir
		}

		// 4. Installed in /Applications
		let systemApplications = URL(fileURLWithPath: "/Applications/Toby.app")
		if FileManager.default.fileExists(atPath: systemApplications.path) {
			return systemApplications
		}

		// 5. Installed in ~/Applications
		let userApplications = home.appendingPathComponent("Applications/Toby.app")
		if FileManager.default.fileExists(atPath: userApplications.path) {
			return userApplications
		}

		return nil
	}

	// MARK: - Generic request

	struct HelperResponse {
		let ok: Bool
		let data: [String: Any]?
		let error: String?
		let needsPermission: Bool
	}

	static func request(_ endpoint: String, body: [String: Any]? = nil) -> HelperResponse {
		// If server not available, try auto-launching Toby.app
		if resolveNativePort() == nil || !checkHealth() {
			ensureAvailable()
		}

		guard let port = resolveNativePort() else {
			return HelperResponse(ok: false, data: nil, error: "Toby.app native server not found.", needsPermission: false)
		}

		let url = URL(string: "http://127.0.0.1:\(port)/api/native/\(endpoint)")!
		var request = URLRequest(url: url)
		request.timeoutInterval = timeoutInterval
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")

		if let body {
			request.httpBody = try? JSONSerialization.data(withJSONObject: body)
		}

		let sem = DispatchSemaphore(value: 0)
		final class Result: @unchecked Sendable {
			var data: Data?
			var error: Error?
			var status: Int = 0
		}
		let result = Result()

		let task = URLSession.shared.dataTask(with: request) { data, response, error in
			result.data = data
			result.error = error
			if let http = response as? HTTPURLResponse {
				result.status = http.statusCode
			}
			sem.signal()
		}
		task.resume()
		sem.wait()

		if let error = result.error {
			return HelperResponse(ok: false, data: nil, error: "Native server request failed: \(error.localizedDescription)", needsPermission: false)
		}

		guard result.status == 200, let data = result.data,
			let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
		else {
			return HelperResponse(ok: false, data: nil, error: "Invalid response from native server (HTTP \(result.status)).", needsPermission: false)
		}

		let ok = json["ok"] as? Bool ?? false
		let needsPermission = json["needsPermission"] as? Bool ?? false
		let error = json["error"] as? String
		let payload = json["data"] as? [String: Any]

		return HelperResponse(ok: ok, data: payload, error: error, needsPermission: needsPermission)
	}

	// MARK: - macOS operations

	static func minimizeAll() -> HelperResponse {
		return request("macos/minimize-all")
	}

	static func minimizeApp(name: String) -> HelperResponse {
		return request("macos/minimize-app", body: ["name": name])
	}

	static func accessibilityStatus() -> HelperResponse {
		return request("macos/accessibility-status")
	}
}
