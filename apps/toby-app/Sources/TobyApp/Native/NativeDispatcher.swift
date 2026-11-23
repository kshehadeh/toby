import Foundation

/// In-process dispatch to the native macOS handlers (EventKit, Contacts,
/// audio, macOS controls, flow triggers). Each endpoint returns the handler
/// JSON body (`{ok, data, error, needsPermission}`).
@MainActor
final class NativeDispatcher {
	static let shared = NativeDispatcher()

	/// Call `/api/native/<endpoint>` and return its JSON body.
	func dispatch(endpoint: String, body: Data?, method: String = "POST") async -> Data {
		await route(path: "/api/native/\(endpoint)", method: method, body: body)
	}

	private func json(_ payload: [String: Any]) -> Data {
		(try? JSONSerialization.data(withJSONObject: payload)) ?? Data(#"{"ok":false,"error":"Encoding failed"}"#.utf8)
	}

	private func route(path: String, method: String, body: Data?) async -> Data {
		if path.hasPrefix("/api/native/flows/triggers/") {
			if path == "/api/native/flows/triggers/folder-assessment", method == "POST" {
                guard let body, let watch = try? JSONDecoder().decode(NativeFolderWatch.self, from: body) else { return json(["ok":false,"error":"Invalid folder"]) }
                do {
                  let scan = try await Task.detached(priority: .utility) { try await NativeFolderScanService.shared.scan(watch, assessment: true) }.value
                  return json(["ok":true,"data":["matchingFiles":scan.files.count,"visitedEntries":scan.visited,"limited":scan.limited,"warning":scan.limited || scan.files.count >= 10000]])
                } catch { return json(["ok":false,"error":error.localizedDescription]) }
            }
            if path == "/api/native/flows/triggers/completion-notification", method == "POST" {
				return await NativeMacOSHandler.flowCompletionNotification(body: body)
			}
			return json(NativeAutomationEventSource.shared.handle(method: method, path: path, body: body))
		}

		if path == "/api/native/feed/notification" {
			guard method == "POST" else { return json(["ok": false, "error": "Method not allowed"]) }
			return await NativeMacOSHandler.feedNotification(body: body)
		}

		guard path.hasPrefix("/api/native/") else {
			return json(["ok": false, "error": "Not found"])
		}

		switch path {
		case "/api/native/health":
			return json(["ok": true, "service": "toby-native"])
		case "/api/native/contacts/request-access":
			return await NativeContactsHandler.requestAccess()
		case "/api/native/contacts/search":
			return await NativeContactsHandler.searchContacts(body: body)
		case "/api/native/contacts/get":
			return await NativeContactsHandler.getContact(body: body)
		case "/api/native/calendar/request-access":
			return await NativeCalendarHandler.requestAccess()
		case "/api/native/calendar/list":
			return await NativeCalendarHandler.listCalendars()
		case "/api/native/calendar/search":
			return await NativeCalendarHandler.searchEvents(body: body)
		case "/api/native/calendar/get":
			return await NativeCalendarHandler.getEvent(body: body)
		case "/api/native/calendar/create":
			return await NativeCalendarHandler.createEvent(body: body)
		case "/api/native/calendar/update":
			return await NativeCalendarHandler.updateEvent(body: body)
		case "/api/native/calendar/delete":
			return await NativeCalendarHandler.deleteEvent(body: body)
		case "/api/native/reminders/request-access":
			return await NativeAppleRemindersHandler.requestAccess()
		case "/api/native/reminders/lists":
			return await NativeAppleRemindersHandler.listReminderLists()
		case "/api/native/reminders/search":
			return await NativeAppleRemindersHandler.searchReminders(body: body)
		case "/api/native/reminders/get":
			return await NativeAppleRemindersHandler.getReminder(body: body)
		case "/api/native/reminders/create":
			return await NativeAppleRemindersHandler.createReminder(body: body)
		case "/api/native/reminders/update":
			return await NativeAppleRemindersHandler.updateReminder(body: body)
		case "/api/native/reminders/complete":
			return await NativeAppleRemindersHandler.completeReminder(body: body)
		case "/api/native/reminders/delete":
			return await NativeAppleRemindersHandler.deleteReminder(body: body)
		case "/api/native/macos/accessibility-status":
			return NativeMacOSHandler.accessibilityStatus()
		case "/api/native/macos/wifi-status":
			return NativeMacOSHandler.wifiStatus()
		case "/api/native/macos/wifi-scan":
			return NativeMacOSHandler.wifiScan()
		case "/api/native/macos/wifi-set-power":
			return NativeMacOSHandler.wifiSetPower(body: body)
		case "/api/native/macos/battery-status":
			return NativeMacOSHandler.batteryStatus()
		case "/api/native/macos/audio-list-outputs":
			return NativeMacOSHandler.audioListOutputs()
		case "/api/native/macos/audio-switch-output":
			return NativeMacOSHandler.audioSwitchOutput(body: body)
		case "/api/native/macos/audio-volume":
			return NativeMacOSHandler.audioVolume()
		case "/api/native/macos/audio-set-volume":
			return NativeMacOSHandler.audioSetVolume(body: body)
		case "/api/native/macos/audio-set-mute":
			return NativeMacOSHandler.audioSetMute(body: body)
		case "/api/native/macos/bluetooth-status":
			return NativeMacOSHandler.bluetoothStatus()
		case "/api/native/macos/bluetooth-set-power":
			return NativeMacOSHandler.bluetoothSetPower(body: body)
		case "/api/native/macos/low-power-status":
			return NativeMacOSHandler.lowPowerStatus()
		case "/api/native/macos/low-power-set":
			return NativeMacOSHandler.lowPowerSet(body: body)
		case "/api/native/macos/shortcuts-run":
			return NativeMacOSHandler.shortcutsRun(body: body)
		case "/api/native/macos/display-brightness":
			return NativeMacOSHandler.displayBrightness()
		case "/api/native/macos/display-set-brightness":
			return NativeMacOSHandler.displaySetBrightness(body: body)
		case "/api/native/macos/clipboard-read":
			return NativeMacOSHandler.clipboardRead()
		case "/api/native/macos/clipboard-write":
			return NativeMacOSHandler.clipboardWrite(body: body)
		case "/api/native/macos/files-list":
			return await NativeFilesHandler.list(body: body)

		case "/api/native/macos/system-info":
			return NativeMacOSHandler.systemInfo()
		case "/api/native/macos/notification-show":
			return await NativeMacOSHandler.notificationShow(body: body)
		case "/api/native/macos/app-quit":
			return NativeMacOSHandler.appQuit(body: body)
		case "/api/native/macos/apps-running":
			return NativeMacOSHandler.appsRunning(body: body)
		case "/api/native/macos/minimize-all":
			return NativeMacOSHandler.minimizeAll()
		case "/api/native/macos/unminimize-all":
			return NativeMacOSHandler.unminimizeAll()
		case "/api/native/macos/minimize-app":
			return NativeMacOSHandler.minimizeApp(body: body)
		case "/api/native/macos/unminimize-app":
			return NativeMacOSHandler.unminimizeApp(body: body)
		case "/api/native/macos/windows-hide-all":
			return NativeMacOSHandler.windowsHideAll()
		case "/api/native/macos/windows-show-all":
			return NativeMacOSHandler.windowsShowAll()
		case "/api/native/macos/window-hide-app":
			return NativeMacOSHandler.windowHideApp(body: body)
		case "/api/native/location/status":
			return NativeLocationHandler.shared.status()
		case "/api/native/location/request-access":
			return await NativeLocationHandler.shared.requestAccess()
		case "/api/native/location/current":
			return await NativeLocationHandler.shared.currentLocation(body: body)
		case "/api/native/audio/status":
			return NativeAudioHandler.shared.status()
		case "/api/native/audio/start":
			return await NativeAudioHandler.shared.start(body: body)
		case "/api/native/audio/stop":
			return await NativeAudioHandler.shared.stop(body: body)
		case "/api/native/audio/transcribe":
			return await NativeSpeechFileTranscription.run(body: body)
		case "/api/native/audio/combine":
			return await NativeAudioHandler.shared.combine(body: body)
		case "/api/native/icloud/status":
			return NativeICloudHandler.status()
		case "/api/native/icloud/todos/list", "/api/native/icloud/todos/read", "/api/native/icloud/todos/write":
			return NativeTodoSyncHandler.handle(String(path.split(separator: "/").last ?? ""), body: body)
		case "/api/native/icloud/ensure":
			return NativeICloudHandler.ensure(body: body)
		case "/api/native/icloud/read":
			return NativeICloudHandler.read(body: body)
		case "/api/native/icloud/write":
			return NativeICloudHandler.write(body: body)
		case "/api/native/icloud/history":
			return NativeICloudHandler.history()
		case "/api/native/icloud/delete":
			return NativeICloudHandler.deleteAll()
		default:
			return json(["ok": false, "error": "Unknown endpoint: \(path)"])
		}
	}
}
