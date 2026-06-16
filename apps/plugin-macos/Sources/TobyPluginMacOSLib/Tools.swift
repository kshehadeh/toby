import Foundation

public enum MacOSTools {
	public struct ExecuteResult {
		public let result: [String: Any]
		public let appliedActions: [String]
	}

	public struct ToolFailure: Error {
		public let message: String
	}

	private static let focusOnShortcutName = "TobyFocusOn"
	private static let focusOffShortcutName = "TobyFocusOff"

	private static let mutatingTools: Set<String> = [
		"macWifiSetPower",
		"macAudioSwitchOutput",
		"macAudioSetVolume",
		"macAudioSetMute",
		"macBluetoothSetPower",
		"macLowPowerModeSet",
		"macFocusSet",
		"macShortcutRun",
		"macDisplaySetBrightness",
		"macClipboardWrite",
		"macWindowsHideAll",
		"macWindowsShowAll",
		"macWindowsMinimizeAll",
		"macWindowsUnminimizeAll",
		"macWindowHideApp",
		"macWindowMinimizeApp",
		"macWindowUnminimizeApp",
	]

	public static var definitions: [[String: Any]] {
		[
			tool(name: "macBatteryStatus", description: "macOS only. Read battery / power snapshot: condition, charge percent, cycle count, charging state, and power source. Uses native IOKit APIs.", readOnly: true, properties: [:]),
			tool(name: "macWifiStatus", description: "macOS only. Show Wi‑Fi power state, current SSID, BSSID, and RSSI using native CoreWLAN APIs.", readOnly: true, properties: [:]),
			tool(name: "macWifiScanNearby", description: "macOS only. Scan nearby Wi‑Fi networks using native CoreWLAN. Returns SSIDs, BSSIDs, and RSSI values. Wi‑Fi should be ON. May require Location Services permission.", readOnly: true, properties: [:]),
			tool(name: "macWifiSetPower", description: "macOS only. Turn Wi‑Fi radio on/off using native CoreWLAN.", properties: ["enabled": prop("boolean", "true = On, false = Off")], required: ["enabled"]),
			tool(name: "macAudioListOutputs", description: "macOS only. List audio output and input device names using native CoreAudio APIs. Shows device names, UIDs, and default status.", readOnly: true, properties: [:]),
			tool(name: "macAudioSwitchOutput", description: "macOS only. Set default output audio device using native CoreAudio. Use this whenever the user asks to switch/change/set audio output. If the device name is not known, call macAudioListOutputs first.", properties: ["deviceSubstring": prop("string", "Substring of output device name, e.g. MacBook Speakers")], required: ["deviceSubstring"]),
			tool(name: "macAudioVolume", description: "macOS only. Get the current system output volume (0-100) and mute state using native CoreAudio.", readOnly: true, properties: [:]),
			tool(name: "macAudioSetVolume", description: "macOS only. Set system output volume (0-100) using native CoreAudio. Automatically unmutes if level > 0.", properties: ["level": prop("number", "Volume level 0-100")], required: ["level"]),
			tool(name: "macAudioSetMute", description: "macOS only. Mute or unmute the system audio output using native CoreAudio.", properties: ["muted": prop("boolean", "true = mute, false = unmute")], required: ["muted"]),
			tool(name: "macBluetoothStatus", description: "macOS only. Read Bluetooth power state and paired/connected devices using native IOBluetooth APIs.", readOnly: true, properties: [:]),
			tool(name: "macBluetoothSetPower", description: "macOS only. Enable/disable Bluetooth using native IOBluetooth APIs. No third-party tools required.", properties: ["enabled": prop("boolean", "")], required: ["enabled"]),
			tool(name: "macLowPowerModeStatus", description: "macOS only. Read low power mode state (may not be available on desktops).", readOnly: true, properties: [:]),
			tool(name: "macLowPowerModeSet", description: "macOS only. Set low power mode on/off. May fail without admin privileges.", properties: ["enabled": prop("boolean", "")], required: ["enabled"]),
			tool(name: "macFocusSet", description: "macOS only. Turn Do Not Disturb / Focus mode on or off on this Mac. Uses bundled Shortcuts \"TobyFocusOn\" and \"TobyFocusOff\" (install via `toby plugins setup macos` if missing). Prefer this over macShortcutRun for Focus/DND requests.", properties: ["enabled": prop("boolean", "true = enable Focus/Do Not Disturb, false = disable")], required: ["enabled"]),
			tool(name: "macShortcutRun", description: "macOS only. Run any Shortcuts.app shortcut by exact name. For Do Not Disturb / Focus, prefer macFocusSet; bundled shortcuts are \"TobyFocusOn\" and \"TobyFocusOff\".", properties: ["name": prop("string", "Exact name of the Shortcut to run.")], required: ["name"]),
			tool(name: "macDisplayBrightness", description: "macOS only. Get the current display brightness level (0-100). May not be supported on all hardware configurations (e.g. some Apple Silicon Macs).", readOnly: true, properties: [:]),
			tool(name: "macDisplaySetBrightness", description: "macOS only. Set display brightness level (0-100). May not be supported on all hardware configurations.", properties: ["level": prop("number", "Brightness level 0-100")], required: ["level"]),
			tool(name: "macClipboardRead", description: "macOS only. Read the current text content of the system clipboard.", readOnly: true, properties: [:]),
			tool(name: "macClipboardWrite", description: "macOS only. Write text to the system clipboard, replacing any current content.", properties: ["text": prop("string", "Text to write to clipboard")], required: ["text"]),
			tool(name: "macSystemInfo", description: "macOS only. Get system information: OS version, hardware model, hostname, uptime, processor count, physical memory, and Apple Silicon status.", readOnly: true, properties: [:]),
			tool(name: "macNotificationsPeek", description: "macOS only. Read Notification Center items — not supported (no stable API). Does not toggle Do Not Disturb / Focus; use macFocusSet for that.", readOnly: true, properties: [:]),
			tool(name: "macWindowsHideAll", description: "macOS only. Hide all other application windows (like the macOS \"Hide Others\" command). Uses native AppKit; no extra permission required.", properties: [:]),
			tool(name: "macWindowsShowAll", description: "macOS only. Show/unhide all currently hidden application windows. Uses native AppKit; no extra permission required.", properties: [:]),
			tool(name: "macWindowsMinimizeAll", description: "macOS only. Minimize all windows of all open applications via the native Accessibility API. Requires Accessibility permission for the app running Toby (System Settings → Privacy & Security → Accessibility).", properties: [:]),
			tool(name: "macWindowsUnminimizeAll", description: "macOS only. Unminimize all minimized windows of all open applications via the native Accessibility API. Requires Accessibility permission.", properties: [:]),
			tool(name: "macWindowHideApp", description: "macOS only. Hide a specific running application's windows by name. Matches localized app name or bundle id substring (case-insensitive). Uses native AppKit.", properties: ["appName": prop("string", "App name to hide (e.g. Safari, Slack). Substring match is allowed.")], required: ["appName"]),
			tool(name: "macWindowMinimizeApp", description: "macOS only. Minimize all windows of a specific running application via the native Accessibility API. Requires Accessibility permission.", properties: ["appName": prop("string", "App name to minimize (e.g. Safari, Slack). Substring match is allowed.")], required: ["appName"]),
			tool(name: "macWindowUnminimizeApp", description: "macOS only. Unminimize all minimized windows of a specific running application via the native Accessibility API. Requires Accessibility permission.", properties: ["appName": prop("string", "App name to unminimize (e.g. Safari, Slack). Substring match is allowed.")], required: ["appName"]),
		]
	}

	public static func execute(tool name: String, input: [String: Any], dryRun: Bool) -> Result<ExecuteResult, ToolFailure> {
		guard SystemClient.isPlatformSupported else {
			return .success(ExecuteResult(result: ["error": "macOS integration tools run only on macOS."], appliedActions: []))
		}

		switch name {
		case "macBatteryStatus":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would read battery / power snapshot."], appliedActions: []))
			}
			do {
				let data = try BatteryCommands.statusData()
				let pmset = [
					data["powerSourceState"] as? String == "AC Power" ? "AC Power" : "Battery Power",
					(data["isCharging"] as? Bool) == true ? "Charging" : "Not Charging",
					"\(data["chargePercent"] as? Int ?? 0)%",
				].joined(separator: "; ")
				let snippet = [
					"Condition: \(data["sourceType"] as? String ?? "unknown")",
					"Charge: \(data["chargePercent"] as? Int ?? 0)%",
					"Cycles: \(data["cycleCount"] as? Int ?? -1)",
					"Max Capacity: \(data["maxCapacity"] as? Int ?? -1)%",
				].joined(separator: "\n")
				return .success(ExecuteResult(result: ["ok": true, "pmset": pmset, "systemProfilerBatteryText": snippet], appliedActions: []))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macWifiStatus":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would query Wi‑Fi state."], appliedActions: []))
			}
			guard let dev = SystemClient.wifiInterface() else {
				return .success(ExecuteResult(result: ["ok": false, "error": "Could not resolve Wi‑Fi interface."], appliedActions: []))
			}
			do {
				let st = try WiFiCommands.statusData()
				let statusLine = (st["powerOn"] as? Bool) == true ? "Power: On" : "Power: Off"
				return .success(ExecuteResult(result: ["device": dev, "ok": true, "statusLine": statusLine], appliedActions: []))
			} catch {
				return .success(ExecuteResult(result: ["device": dev, "ok": false, "statusLine": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macWifiScanNearby":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would scan for nearby Wi‑Fi."], appliedActions: []))
			}
			do {
				let data = try WiFiCommands.scanData()
				let networks = (data["networks"] as? [[String: Any]] ?? []).map { net -> [String: Any] in
					["ssid": net["ssid"] as? String ?? "", "bssid": net["bssid"] as? String ?? "", "rssi": net["rssi"] as? Int ?? 0]
				}
				let rawPreview = (try? JSONSerialization.data(withJSONObject: data)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
				var result: [String: Any] = [
					"ok": true,
					"device": data["interface"] as? String ?? "",
					"networks": networks,
					"scanSource": "corewlan",
					"rawPreviewTail": String(rawPreview.suffix(4500)),
				]
				if networks.isEmpty && !rawPreview.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
					result["hint"] = "Parsed zero BSSIDs — Wi‑Fi may be off."
				}
				return .success(ExecuteResult(result: result, appliedActions: []))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "device": NSNull(), "error": SystemClient.errorMessage(error), "networks": [], "scanSource": "corewlan", "rawPreviewTail": ""], appliedActions: []))
			}

		case "macWifiSetPower":
			guard let enabled = boolValue(input["enabled"]) else {
				return .failure(ToolFailure(message: "enabled is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would \(enabled ? "enable" : "disable") Wi‑Fi."
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			guard let dev = SystemClient.wifiInterface() else {
				return .success(ExecuteResult(result: ["ok": false, "error": "No Wi‑Fi interface found."], appliedActions: []))
			}
			do {
				try WiFiCommands.setPower(enabled: enabled)
				let action = "Wi‑Fi \(enabled ? "turned On" : "turned Off") on \(dev)."
				return .success(ExecuteResult(result: ["ok": true, "device": dev, "message": "Wi‑Fi power set successfully"], appliedActions: [action]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "device": dev, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macAudioListOutputs":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would list audio output and input devices."], appliedActions: []))
			}
			do {
				let data = try AudioCommands.listData()
				let outputs = (data["outputs"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
				let inputs = (data["inputs"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
				let rawPreview = (try? JSONSerialization.data(withJSONObject: data)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
				var result: [String: Any] = [
					"ok": true,
					"devices": outputs,
					"outputs": outputs,
					"inputs": inputs,
				]
				result["hintForSwitchTool"] = outputs.isEmpty
					? "Use macAudioSwitchOutput with a substring matching an entry."
					: "These are the available output device names. If the user requested a target that clearly matches one, call macAudioSwitchOutput next with that exact or substring name; do not stop after listing."
				return .success(ExecuteResult(result: result, appliedActions: []))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macAudioSwitchOutput":
			guard let deviceSubstring = stringValue(input["deviceSubstring"])?.trimmingCharacters(in: .whitespacesAndNewlines), !deviceSubstring.isEmpty else {
				return .failure(ToolFailure(message: "deviceSubstring is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would switch audio output matching \"\(deviceSubstring)\"."
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would switch audio output."], appliedActions: [msg]))
			}
			do {
				let result = try AudioCommands.switchOutput(device: deviceSubstring)
				let action = "Switched audio output to match \"\(deviceSubstring)\"."
				return .success(ExecuteResult(result: ["ok": true, "stdout": "Switched to \(result["name"] as? String ?? deviceSubstring)"], appliedActions: [action]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macAudioVolume":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would read system volume."], appliedActions: []))
			}
			do {
				let data = try AudioCommands.volumeData()
				return .success(ExecuteResult(result: ["ok": true, "volume": data["volume"] as Any, "muted": data["muted"] as Any], appliedActions: []))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macAudioSetVolume":
			guard let level = intValue(input["level"]), (0...100).contains(level) else {
				return .failure(ToolFailure(message: "level must be 0-100."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would set volume to \(level)."
				return .success(ExecuteResult(result: ["dryRun": true], appliedActions: [msg]))
			}
			do {
				try AudioCommands.setVolume(level: level)
				return .success(ExecuteResult(result: ["ok": true, "level": level], appliedActions: ["Volume set to \(level)."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macAudioSetMute":
			guard let muted = boolValue(input["muted"]) else {
				return .failure(ToolFailure(message: "muted is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would \(muted ? "mute" : "unmute") audio."
				return .success(ExecuteResult(result: ["dryRun": true], appliedActions: [msg]))
			}
			do {
				try AudioCommands.setMute(muted: muted)
				return .success(ExecuteResult(result: ["ok": true, "muted": muted], appliedActions: ["Audio \(muted ? "muted" : "unmuted")."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macBluetoothStatus":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would read Bluetooth status."], appliedActions: []))
			}
			do {
				let data = try BluetoothCommands.statusData()
				return .success(ExecuteResult(result: ["ok": true, "powerState": data["powerState"] as Any, "devices": data["devices"] as Any, "deviceCount": data["deviceCount"] as Any], appliedActions: []))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macBluetoothSetPower":
			guard let enabled = boolValue(input["enabled"]) else {
				return .failure(ToolFailure(message: "enabled is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would \(enabled ? "enable" : "disable") Bluetooth."
				return .success(ExecuteResult(result: ["dryRun": true], appliedActions: [msg]))
			}
			do {
				let data = try BluetoothCommands.setPower(enabled: enabled)
				if (data["success"] as? Bool) != true {
					return .success(ExecuteResult(result: ["ok": false, "error": "Bluetooth power state: \(data["actual"] as? String ?? "unknown") (requested \(enabled ? "on" : "off"))"], appliedActions: []))
				}
				return .success(ExecuteResult(result: ["ok": true], appliedActions: ["Bluetooth \(enabled ? "enabled" : "disabled")."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macLowPowerModeStatus":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would read low power mode state."], appliedActions: []))
			}
			do {
				let data = try LowPowerCommands.statusData()
				return .success(ExecuteResult(result: ["ok": true, "raw": "lowpowermode \(data["lowPowerMode"] as? String ?? "")"], appliedActions: []))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "raw": "", "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macLowPowerModeSet":
			guard let enabled = boolValue(input["enabled"]) else {
				return .failure(ToolFailure(message: "enabled is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would set low power mode \(enabled ? "on" : "off")."
				return .success(ExecuteResult(result: ["dryRun": true], appliedActions: [msg]))
			}
			do {
				let data = try LowPowerCommands.setEnabled(enabled)
				return .success(ExecuteResult(result: ["ok": true, "stdout": "lowpowermode \(data["lowPowerMode"] as? String ?? "")"], appliedActions: ["Low power mode → \(enabled ? "on" : "off")."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "stdout": "", "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macFocusSet":
			guard let enabled = boolValue(input["enabled"]) else {
				return .failure(ToolFailure(message: "enabled is required."))
			}
			let shortcutName = enabled ? focusOnShortcutName : focusOffShortcutName
			if dryRun {
				let msg = "[DRY RUN] Would \(enabled ? "enable" : "disable") Focus / Do Not Disturb via \"\(shortcutName)\"."
				return .success(ExecuteResult(result: ["dryRun": true, "shortcutName": shortcutName], appliedActions: [msg]))
			}
			do {
				let data = try ShortcutsCommands.run(name: shortcutName)
				let output = data["output"] as? String ?? ""
				let action = "Focus / Do Not Disturb \(enabled ? "enabled" : "disabled")."
				return .success(ExecuteResult(
					result: [
						"ok": true,
						"enabled": enabled,
						"shortcutName": shortcutName,
						"stdoutTail": String(output.suffix(2000)),
					],
					appliedActions: [action]
				))
			} catch {
				return .success(ExecuteResult(
					result: [
						"ok": false,
						"enabled": enabled,
						"shortcutName": shortcutName,
						"error": SystemClient.errorMessage(error),
						"hint": "Run `toby plugins setup macos` to install bundled Focus shortcuts, then confirm each import in Shortcuts.app.",
					],
					appliedActions: []
				))
			}

		case "macShortcutRun":
			guard let shortcutName = stringValue(input["name"])?.trimmingCharacters(in: .whitespacesAndNewlines), !shortcutName.isEmpty else {
				return .success(ExecuteResult(result: ["ok": false, "error": "Shortcut name is required."], appliedActions: []))
			}
			if dryRun {
				let msg = "[DRY RUN] shortcuts run \"\(shortcutName)\""
				return .success(ExecuteResult(result: ["dryRun": true, "shortcutName": shortcutName], appliedActions: [msg]))
			}
			do {
				let data = try ShortcutsCommands.run(name: shortcutName)
				let output = data["output"] as? String ?? ""
				return .success(ExecuteResult(result: ["ok": true, "shortcutName": shortcutName, "stdoutTail": String(output.suffix(2000))], appliedActions: ["Shortcuts ran \"\(shortcutName)\"."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "shortcutName": shortcutName, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macDisplayBrightness":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would read display brightness."], appliedActions: []))
			}
			do {
				let data = try DisplayCommands.brightnessData()
				let displays = data["displays"] as? [[String: Any]] ?? []
				let main = displays.first
				guard let main else {
					return .success(ExecuteResult(result: ["ok": false, "error": "No display found"], appliedActions: []))
				}
				return .success(ExecuteResult(result: ["ok": true, "brightness": main["brightness"] as Any, "percent": main["percent"] as Any], appliedActions: []))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macDisplaySetBrightness":
			guard let level = intValue(input["level"]), (0...100).contains(level) else {
				return .failure(ToolFailure(message: "level must be 0-100."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would set display brightness to \(level)."
				return .success(ExecuteResult(result: ["dryRun": true], appliedActions: [msg]))
			}
			do {
				try DisplayCommands.setBrightness(level: level)
				return .success(ExecuteResult(result: ["ok": true, "level": level], appliedActions: ["Display brightness set to \(level)."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macClipboardRead":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would read clipboard."], appliedActions: []))
			}
			do {
				let data = try ClipboardCommands.readData()
				return .success(ExecuteResult(result: ["ok": true, "text": data["text"] as Any, "hasContent": data["hasContent"] as Any], appliedActions: []))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macClipboardWrite":
			guard let text = stringValue(input["text"]) else {
				return .failure(ToolFailure(message: "text is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would write text to clipboard."
				return .success(ExecuteResult(result: ["dryRun": true], appliedActions: [msg]))
			}
			do {
				try ClipboardCommands.writeData(text: text)
				return .success(ExecuteResult(result: ["ok": true], appliedActions: ["Copied text to clipboard."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macSystemInfo":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would read system info."], appliedActions: []))
			}
			do {
				let data = try SystemInfoCommands.infoData()
				var result: [String: Any] = ["ok": true]
				for (key, value) in data { result[key] = value }
				return .success(ExecuteResult(result: result, appliedActions: []))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macNotificationsPeek":
			return .success(ExecuteResult(
				result: [
					"supported": false,
					"message": "Toby cannot list Notification Center items via a stable public API. To turn Do Not Disturb / Focus on or off, use macFocusSet instead.",
				],
				appliedActions: []
			))

		case "macWindowsHideAll":
			if dryRun {
				let msg = "[DRY RUN] Would hide all other application windows."
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			do {
				let data = try WindowCommands.hideAll()
				let count = data["hiddenCount"] as? Int ?? 0
				return .success(ExecuteResult(result: ["ok": true, "hiddenCount": count, "hiddenApps": data["hiddenApps"] as? [String] ?? []], appliedActions: ["Hid \(count) other application(s)."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macWindowsShowAll":
			if dryRun {
				let msg = "[DRY RUN] Would unhide all hidden applications."
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			do {
				let data = try WindowCommands.showAll()
				let count = data["shownCount"] as? Int ?? 0
				return .success(ExecuteResult(result: ["ok": true, "shownCount": count, "shownApps": data["shownApps"] as? [String] ?? []], appliedActions: ["Unhid \(count) application(s)."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macWindowsMinimizeAll":
			if dryRun {
				let msg = "[DRY RUN] Would minimize all windows of all open applications."
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			do {
				let data = try WindowCommands.minimizeAll()
				let count = data["minimizedWindowCount"] as? Int ?? 0
				return .success(ExecuteResult(result: ["ok": true, "minimizedWindowCount": count, "apps": data["apps"] as? [String] ?? []], appliedActions: ["Minimized \(count) window(s)."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macWindowsUnminimizeAll":
			if dryRun {
				let msg = "[DRY RUN] Would unminimize all minimized windows of all open applications."
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			do {
				let data = try WindowCommands.unminimizeAll()
				let count = data["unminimizedWindowCount"] as? Int ?? 0
				return .success(ExecuteResult(result: ["ok": true, "unminimizedWindowCount": count, "apps": data["apps"] as? [String] ?? []], appliedActions: ["Unminimized \(count) window(s)."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macWindowHideApp":
			guard let appName = stringValue(input["appName"])?.trimmingCharacters(in: .whitespacesAndNewlines), !appName.isEmpty else {
				return .failure(ToolFailure(message: "appName is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would hide \"\(appName)\"."
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			do {
				let data = try WindowCommands.hideApp(name: appName)
				let count = data["hiddenCount"] as? Int ?? 0
				return .success(ExecuteResult(result: ["ok": true, "hiddenCount": count, "hiddenApps": data["hiddenApps"] as? [String] ?? []], appliedActions: ["Hid \(count) app(s) matching \"\(appName)\"."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macWindowMinimizeApp":
			guard let appName = stringValue(input["appName"])?.trimmingCharacters(in: .whitespacesAndNewlines), !appName.isEmpty else {
				return .failure(ToolFailure(message: "appName is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would minimize windows of \"\(appName)\"."
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			do {
				let data = try WindowCommands.minimizeApp(name: appName)
				let count = data["minimizedWindowCount"] as? Int ?? 0
				return .success(ExecuteResult(result: ["ok": true, "minimizedWindowCount": count, "apps": data["apps"] as? [String] ?? []], appliedActions: ["Minimized \(count) window(s) of \"\(appName)\"."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		case "macWindowUnminimizeApp":
			guard let appName = stringValue(input["appName"])?.trimmingCharacters(in: .whitespacesAndNewlines), !appName.isEmpty else {
				return .failure(ToolFailure(message: "appName is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would unminimize windows of \"\(appName)\"."
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			do {
				let data = try WindowCommands.unminimizeApp(name: appName)
				let count = data["unminimizedWindowCount"] as? Int ?? 0
				return .success(ExecuteResult(result: ["ok": true, "unminimizedWindowCount": count, "apps": data["apps"] as? [String] ?? []], appliedActions: ["Unminimized \(count) window(s) of \"\(appName)\"."]))
			} catch {
				return .success(ExecuteResult(result: ["ok": false, "error": SystemClient.errorMessage(error)], appliedActions: []))
			}

		default:
			return .failure(ToolFailure(message: "Unknown tool: \(name)"))
		}
	}

	private static func tool(name: String, description: String, readOnly: Bool = false, properties: [String: Any], required: [String] = []) -> [String: Any] {
		var schema: [String: Any] = ["type": "object", "properties": properties]
		if !required.isEmpty { schema["required"] = required }
		var def: [String: Any] = ["name": name, "description": description, "inputSchema": schema]
		if readOnly { def["readOnly"] = true }
		return def
	}

	private static func prop(_ type: String, _ description: String) -> [String: Any] {
		["type": type, "description": description]
	}

	private static func stringValue(_ value: Any?) -> String? {
		if let s = value as? String { return s }
		return nil
	}

	private static func intValue(_ value: Any?) -> Int? {
		if let n = value as? Int { return n }
		if let d = value as? Double { return Int(d) }
		if let n = value as? NSNumber { return n.intValue }
		return nil
	}

	private static func boolValue(_ value: Any?) -> Bool? {
		if let b = value as? Bool { return b }
		if let n = value as? NSNumber { return n.boolValue }
		return nil
	}
}
