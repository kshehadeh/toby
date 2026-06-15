import Foundation

/// HTTP client that routes permission-gated operations through Toby.app's native API server.
/// Falls back to in-process calls when Toby.app is not running.
enum NativeHelperClient {
	private static let timeoutInterval: TimeInterval = 30

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

	// MARK: - Generic request

	struct HelperResponse {
		let ok: Bool
		let data: [String: Any]?
		let error: String?
		let needsPermission: Bool
	}

	static func request(_ endpoint: String, body: [String: Any]? = nil) -> HelperResponse {
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
