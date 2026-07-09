import Foundation

enum ConfigReader {
	/// Resolves the Toby data directory, respecting the `TOBY_DIR` env var
	/// the same way the CLI's `resolveTobyDir()` does.
	static func resolveTobyDir() -> String {
		if let override = ProcessInfo.processInfo.environment["TOBY_DIR"]?
			.trimmingCharacters(in: .whitespacesAndNewlines), !override.isEmpty {
			return override
		}
		return FileManager.default.homeDirectoryForCurrentUser
			.appendingPathComponent(".toby").path
	}

	static func resolveDaemonPort() -> Int {
		let configURL = URL(fileURLWithPath: resolveTobyDir())
			.appendingPathComponent("config.json")
		guard
			let data = try? Data(contentsOf: configURL),
			let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let web = json["web"] as? [String: Any],
			let port = web["port"] as? Int
		else {
			return 7847
		}
		return port
	}

	static func baseURL() -> URL {
		URL(string: "http://127.0.0.1:\(resolveDaemonPort())")!
	}
}
