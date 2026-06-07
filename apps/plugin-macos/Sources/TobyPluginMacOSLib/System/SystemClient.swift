import Foundation

public enum SystemClient {
	public static var isPlatformSupported: Bool {
		#if os(macOS)
		return true
		#else
		return false
		#endif
	}

	public static func smokeTest() throws {
		_ = try SystemInfoCommands.infoData()
	}

	public static func validateSubtools() -> [[String: Any]] {
		var checks: [[String: Any]] = []
		do {
			_ = try WiFiCommands.statusData()
			checks.append(["tool": "wifi status", "ok": true, "details": "reachable"])
		} catch {
			checks.append(["tool": "wifi status", "ok": false, "details": String(error.localizedDescription.prefix(200))])
		}
		do {
			_ = try BatteryCommands.statusData()
			checks.append(["tool": "battery status", "ok": true, "details": "readable"])
		} catch {
			checks.append(["tool": "battery status", "ok": false, "details": String(error.localizedDescription.prefix(200))])
		}
		return checks
	}

	static func errorMessage(_ error: Error) -> String {
		if let helper = error as? HelperError {
			return helper.description
		}
		return error.localizedDescription
	}

	static func wifiInterface() -> String? {
		(try? WiFiCommands.statusData())?["interface"] as? String
	}
}
