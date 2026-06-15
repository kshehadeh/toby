import AppKit
import ApplicationServices
import Foundation

@MainActor
enum NativeMacOSHandler {
	// MARK: - Accessibility status

	static func accessibilityStatus() -> Data {
		let trusted = AXIsProcessTrusted()
		return json(["ok": true, "data": ["accessibilityGranted": trusted]])
	}

	// MARK: - Minimize all

	static func minimizeAll() -> Data {
		guard ensureAccessibility() else {
			return json(["ok": false, "error": "Accessibility permission is required to minimize windows. Grant access to Toby in System Settings > Privacy & Security > Accessibility.", "needsPermission": true])
		}

		let apps = regularApps()
		let frontmost = NSWorkspace.shared.frontmostApplication
		var minimizedWindowCount = 0
		var touchedApps: [String] = []
		var skippedApps: [String] = []

		for app in apps {
			if let front = frontmost, front.processIdentifier == app.processIdentifier { continue }
			let result = minimizeWindows(for: app.processIdentifier)
			if result.minimized > 0 {
				minimizedWindowCount += result.minimized
				if let name = app.localizedName { touchedApps.append(name) }
			} else if !result.hadWindows, let name = app.localizedName {
				skippedApps.append(name)
			}
		}

		return json([
			"ok": true,
			"data": [
				"minimizedWindowCount": minimizedWindowCount,
				"apps": touchedApps,
				"appsWithoutWindows": skippedApps,
			],
		])
	}

	// MARK: - Minimize app

	static func minimizeApp(body: Data?) -> Data {
		guard ensureAccessibility() else {
			return json(["ok": false, "error": "Accessibility permission is required to minimize windows. Grant access to Toby in System Settings > Privacy & Security > Accessibility.", "needsPermission": true])
		}

		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let name = stringValue(input["name"]), !name.isEmpty
		else {
			return json(["ok": false, "error": "name is required."])
		}

		let matches = matchApps(name: name)
		guard !matches.isEmpty else {
			return json(["ok": false, "error": "No running application matched \"\(name)\"."])
		}

		var minimizedWindowCount = 0
		var touchedApps: [String] = []
		for app in matches {
			let result = minimizeWindows(for: app.processIdentifier)
			if result.minimized > 0 {
				minimizedWindowCount += result.minimized
				if let n = app.localizedName { touchedApps.append(n) }
			}
		}

		return json([
			"ok": true,
			"data": [
				"minimizedWindowCount": minimizedWindowCount,
				"apps": touchedApps,
			],
		])
	}

	// MARK: - Helpers

	private static func ensureAccessibility() -> Bool {
		if AXIsProcessTrusted() { return true }
		let options: CFDictionary = ["AXTrustedCheckOptionPrompt": kCFBooleanTrue!] as CFDictionary
		_ = AXIsProcessTrustedWithOptions(options)
		return false
	}

	private static func regularApps() -> [NSRunningApplication] {
		NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
	}

	private static func matchApps(name: String) -> [NSRunningApplication] {
		let needle = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		guard !needle.isEmpty else { return [] }
		return regularApps().filter { app in
			let local = app.localizedName?.lowercased() ?? ""
			let bundle = app.bundleIdentifier?.lowercased() ?? ""
			return local == needle || local.contains(needle) || bundle.contains(needle)
		}
	}

	private struct MinimizeResult {
		let minimized: Int
		let hadWindows: Bool
	}

	private static func minimizeWindows(for pid: pid_t) -> MinimizeResult {
		let appElement = AXUIElementCreateApplication(pid)
		var windowsRef: CFTypeRef?
		let status = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsRef)
		if status != .success {
			return MinimizeResult(minimized: 0, hadWindows: false)
		}
		guard let windows = windowsRef as? [AXUIElement], !windows.isEmpty else {
			return MinimizeResult(minimized: 0, hadWindows: false)
		}
		var count = 0
		for window in windows {
			var minimizedRef: CFTypeRef?
			let getStatus = AXUIElementCopyAttributeValue(window, kAXMinimizedAttribute as CFString, &minimizedRef)
			if getStatus == .success, let already = minimizedRef as? Bool, already {
				continue
			}
			let setStatus = AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
			if setStatus == .success {
				count += 1
			}
		}
		return MinimizeResult(minimized: count, hadWindows: true)
	}

	private static func stringValue(_ value: Any?) -> String? {
		if let s = value as? String { return s }
		return nil
	}

	private static func json(_ payload: [String: Any]) -> Data {
		guard JSONSerialization.isValidJSONObject(payload),
			let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
		else {
			return Data("{\"ok\":false,\"error\":\"encoding error\"}".utf8)
		}
		return data
	}
}
