import AppKit
import ApplicationServices
import Foundation

enum WindowCommands {
	static func hideAll() throws -> [String: Any] {
		let apps = regularApps()
		let frontmost = NSWorkspace.shared.frontmostApplication
		var hiddenNames: [String] = []
		for app in apps {
			if let front = frontmost, front.processIdentifier == app.processIdentifier {
				continue
			}
			if app.isHidden { continue }
			if app.hide() {
				if let name = app.localizedName { hiddenNames.append(name) }
			}
		}
		return [
			"hiddenCount": hiddenNames.count,
			"hiddenApps": hiddenNames,
		]
	}

	static func showAll() throws -> [String: Any] {
		let apps = regularApps()
		var shownNames: [String] = []
		for app in apps where app.isHidden {
			if app.unhide() {
				if let name = app.localizedName { shownNames.append(name) }
			}
		}
		return [
			"shownCount": shownNames.count,
			"shownApps": shownNames,
		]
	}

	static func minimizeAll() throws -> [String: Any] {
		// Try Toby.app native helper first (proper Accessibility identity)
		if NativeHelperClient.isAvailable() {
			let response = NativeHelperClient.minimizeAll()
			if response.ok, let data = response.data {
				return data
			}
			if response.needsPermission {
				throw HelperError.permission("Accessibility permission is required to minimize windows. Grant access to Toby in System Settings → Privacy & Security → Accessibility.")
			}
			// Fall through to in-process attempt
		}

		// Fall back to in-process Accessibility
		try requireAccessibility()
		let apps = regularApps()
		var minimizedWindowCount = 0
		var touchedApps: [String] = []
		var skippedApps: [String] = []
		for app in apps {
			let result = minimizeWindows(for: app.processIdentifier)
			if result.minimized > 0 {
				minimizedWindowCount += result.minimized
				if let name = app.localizedName { touchedApps.append(name) }
			} else if result.hadWindows == false, let name = app.localizedName {
				skippedApps.append(name)
			}
		}
		return [
			"minimizedWindowCount": minimizedWindowCount,
			"apps": touchedApps,
			"appsWithoutWindows": skippedApps,
		]
	}

	static func unminimizeAll() throws -> [String: Any] {
		// Try Toby.app native helper first (proper Accessibility identity)
		if NativeHelperClient.isAvailable() {
			let response = NativeHelperClient.unminimizeAll()
			if response.ok, let data = response.data {
				return data
			}
			if response.needsPermission {
				throw HelperError.permission("Accessibility permission is required to unminimize windows. Grant access to Toby in System Settings → Privacy & Security → Accessibility.")
			}
			// Fall through to in-process attempt
		}

		// Fall back to in-process Accessibility
		try requireAccessibility()
		let apps = regularApps()
		var unminimizedWindowCount = 0
		var touchedApps: [String] = []
		var skippedApps: [String] = []
		for app in apps {
			let result = unminimizeWindows(for: app.processIdentifier)
			if result.unminimized > 0 {
				unminimizedWindowCount += result.unminimized
				if let name = app.localizedName { touchedApps.append(name) }
			} else if result.hadWindows == false, let name = app.localizedName {
				skippedApps.append(name)
			}
		}
		return [
			"unminimizedWindowCount": unminimizedWindowCount,
			"apps": touchedApps,
			"appsWithoutWindows": skippedApps,
		]
	}

	static func hideApp(name: String) throws -> [String: Any] {
		let matches = matchApps(name: name)
		guard !matches.isEmpty else {
			throw HelperError.runtime("No running application matched \"\(name)\".")
		}
		var hiddenNames: [String] = []
		for app in matches {
			if app.isHidden { continue }
			if app.hide() {
				if let n = app.localizedName { hiddenNames.append(n) }
			}
		}
		return [
			"hiddenCount": hiddenNames.count,
			"hiddenApps": hiddenNames,
		]
	}

	static func minimizeApp(name: String) throws -> [String: Any] {
		// Try Toby.app native helper first (proper Accessibility identity)
		if NativeHelperClient.isAvailable() {
			let response = NativeHelperClient.minimizeApp(name: name)
			if response.ok, let data = response.data {
				return data
			}
			if response.needsPermission {
				throw HelperError.permission("Accessibility permission is required to minimize windows. Grant access to Toby in System Settings → Privacy & Security → Accessibility.")
			}
			// Fall through to in-process attempt
		}

		// Fall back to in-process Accessibility
		try requireAccessibility()
		let matches = matchApps(name: name)
		guard !matches.isEmpty else {
			throw HelperError.runtime("No running application matched \"\(name)\".")
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
		return [
			"minimizedWindowCount": minimizedWindowCount,
			"apps": touchedApps,
		]
	}

	static func unminimizeApp(name: String) throws -> [String: Any] {
		// Try Toby.app native helper first (proper Accessibility identity)
		if NativeHelperClient.isAvailable() {
			let response = NativeHelperClient.unminimizeApp(name: name)
			if response.ok, let data = response.data {
				return data
			}
			if response.needsPermission {
				throw HelperError.permission("Accessibility permission is required to unminimize windows. Grant access to Toby in System Settings → Privacy & Security → Accessibility.")
			}
			// Fall through to in-process attempt
		}

		// Fall back to in-process Accessibility
		try requireAccessibility()
		let matches = matchApps(name: name)
		guard !matches.isEmpty else {
			throw HelperError.runtime("No running application matched \"\(name)\".")
		}
		var unminimizedWindowCount = 0
		var touchedApps: [String] = []
		for app in matches {
			let result = unminimizeWindows(for: app.processIdentifier)
			if result.unminimized > 0 {
				unminimizedWindowCount += result.unminimized
				if let n = app.localizedName { touchedApps.append(n) }
			}
		}
		return [
			"unminimizedWindowCount": unminimizedWindowCount,
			"apps": touchedApps,
		]
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

	private static func requireAccessibility() throws {
		if AXIsProcessTrusted() { return }
		var fingerprint = PluginLog.processFingerprint()
		fingerprint["api"] = "AXIsProcessTrusted"
		PluginLog.warn("accessibility_denied", data: fingerprint)
		let exe = fingerprint["executable"] as? String ?? "(unknown)"
		let parent = fingerprint["parentExecutable"] as? String
		var hint = "Accessibility permission is required to minimize or unminimize windows. macOS attributes this call to: \(exe)."
		if let parent, !parent.isEmpty {
			hint += " Parent process: \(parent)."
		}
		hint += " Run `toby plugins setup macos` to surface the System Settings prompt, then enable the entry under System Settings → Privacy & Security → Accessibility. Recent logs are in `~/.toby/plugin-macos.log`."
		throw HelperError.permission(hint)
	}

	private struct MinimizeResult {
		let minimized: Int
		let hadWindows: Bool
	}

	private struct UnminimizeResult {
		let unminimized: Int
		let hadWindows: Bool
	}

	private static func minimizeWindows(for pid: pid_t) -> MinimizeResult {
		let appElement = AXUIElementCreateApplication(pid)
		var windowsRef: CFTypeRef?
		let status = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsRef)
		if status != .success {
			PluginLog.warn("ax_copy_windows_failed", data: [
				"pid": Int(pid),
				"axError": status.rawValue,
				"axErrorName": axErrorName(status),
			])
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
			} else {
				PluginLog.warn("ax_set_minimized_failed", data: [
					"pid": Int(pid),
					"axError": setStatus.rawValue,
					"axErrorName": axErrorName(setStatus),
				])
			}
		}
		return MinimizeResult(minimized: count, hadWindows: true)
	}

	private static func unminimizeWindows(for pid: pid_t) -> UnminimizeResult {
		let appElement = AXUIElementCreateApplication(pid)
		var windowsRef: CFTypeRef?
		let status = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowsRef)
		if status != .success {
			PluginLog.warn("ax_copy_windows_failed", data: [
				"pid": Int(pid),
				"axError": status.rawValue,
				"axErrorName": axErrorName(status),
			])
			return UnminimizeResult(unminimized: 0, hadWindows: false)
		}
		guard let windows = windowsRef as? [AXUIElement], !windows.isEmpty else {
			return UnminimizeResult(unminimized: 0, hadWindows: false)
		}
		var count = 0
		for window in windows {
			var minimizedRef: CFTypeRef?
			let getStatus = AXUIElementCopyAttributeValue(window, kAXMinimizedAttribute as CFString, &minimizedRef)
			if getStatus == .success, let already = minimizedRef as? Bool, !already {
				continue
			}
			let setStatus = AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
			if setStatus == .success {
				count += 1
			} else {
				PluginLog.warn("ax_set_unminimized_failed", data: [
					"pid": Int(pid),
					"axError": setStatus.rawValue,
					"axErrorName": axErrorName(setStatus),
				])
			}
		}
		return UnminimizeResult(unminimized: count, hadWindows: true)
	}

	private static func axErrorName(_ error: AXError) -> String {
		switch error {
		case .success: return "success"
		case .failure: return "failure"
		case .illegalArgument: return "illegalArgument"
		case .invalidUIElement: return "invalidUIElement"
		case .invalidUIElementObserver: return "invalidUIElementObserver"
		case .cannotComplete: return "cannotComplete"
		case .attributeUnsupported: return "attributeUnsupported"
		case .actionUnsupported: return "actionUnsupported"
		case .notificationUnsupported: return "notificationUnsupported"
		case .notImplemented: return "notImplemented"
		case .notificationAlreadyRegistered: return "notificationAlreadyRegistered"
		case .notificationNotRegistered: return "notificationNotRegistered"
		case .apiDisabled: return "apiDisabled"
		case .noValue: return "noValue"
		case .parameterizedAttributeUnsupported: return "parameterizedAttributeUnsupported"
		case .notEnoughPrecision: return "notEnoughPrecision"
		@unknown default: return "unknown(\(error.rawValue))"
		}
	}
}
