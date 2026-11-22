import Foundation
import TobyAI

/// Calendar, Reminders, Contacts, and macOS-control chat tools (formerly the
/// applecalendar/applereminders/applecontacts/macos plugins). Definitions are
/// generated from the plugins (`Resources/apple-tools.json`); execution calls
/// the app's native handlers through `NativeBridge`.
public struct AppleTools: Sendable {
	struct Definition: Sendable {
		var group: String
		var name: String
		var title: String
		var description: String
		var readOnly: Bool
		var schema: JSONValue
	}

	static let definitions: [Definition] = {
		guard let url = Bundle.module.url(forResource: "apple-tools", withExtension: "json", subdirectory: "Resources"),
		      let data = try? Data(contentsOf: url),
		      let list = try? JSONDecoder().decode(JSONValue.self, from: data).arrayValue else { return [] }
		return list.compactMap { item in
			guard let name = item["name"]?.stringValue, let group = item["group"]?.stringValue else { return nil }
			return Definition(group: group, name: name, title: item["title"]?.stringValue ?? name, description: item["description"]?.stringValue ?? "",
			                  readOnly: item["readOnly"] == true, schema: item["inputSchema"] ?? ["type": "object", "properties": [:]])
		}
	}()

	/// Tool name → native endpoint. Unlisted macOS tools use their own mapping below.
	static let endpoints: [String: String] = [
		"listCalendars": "calendar/list", "searchCalendarEvents": "calendar/search", "getCalendarEvent": "calendar/get",
		"createCalendarEvent": "calendar/create", "updateCalendarEvent": "calendar/update", "deleteCalendarEvent": "calendar/delete",
		"listReminderLists": "reminders/lists", "searchReminders": "reminders/search", "getReminder": "reminders/get",
		"createReminder": "reminders/create", "updateReminder": "reminders/update", "completeReminder": "reminders/complete",
		"deleteReminder": "reminders/delete", "searchContacts": "contacts/search", "getContact": "contacts/get",
		"macFilesList": "macos/files-list", "macBatteryStatus": "macos/battery-status", "macWifiStatus": "macos/wifi-status",
		"macWifiScanNearby": "macos/wifi-scan", "macWifiSetPower": "macos/wifi-set-power", "macAudioListOutputs": "macos/audio-list-outputs",
		"macAudioSwitchOutput": "macos/audio-switch-output", "macAudioVolume": "macos/audio-volume", "macAudioSetVolume": "macos/audio-set-volume",
		"macAudioSetMute": "macos/audio-set-mute", "macBluetoothStatus": "macos/bluetooth-status", "macBluetoothSetPower": "macos/bluetooth-set-power",
		"macLowPowerModeStatus": "macos/low-power-status", "macLowPowerModeSet": "macos/low-power-set", "macShortcutRun": "macos/shortcuts-run",
		"macFocusSet": "macos/shortcuts-run", "macDisplayBrightness": "macos/display-brightness", "macDisplaySetBrightness": "macos/display-set-brightness",
		"macClipboardRead": "macos/clipboard-read", "macClipboardWrite": "macos/clipboard-write", "macSystemInfo": "macos/system-info",
		"macNotificationShow": "macos/notification-show", "macWindowsHideAll": "macos/windows-hide-all", "macWindowsShowAll": "macos/windows-show-all",
		"macWindowsMinimizeAll": "macos/minimize-all", "macWindowsUnminimizeAll": "macos/unminimize-all", "macAppQuit": "macos/app-quit",
		"macAppsRunning": "macos/apps-running", "macWindowHideApp": "macos/window-hide-app", "macWindowMinimizeApp": "macos/minimize-app",
		"macWindowUnminimizeApp": "macos/unminimize-app",
	]

	let bridge: any NativeBridge

	public init(bridge: any NativeBridge) {
		self.bridge = bridge
	}

	/// Shape the request body for a tool (pass-through with the plugins' renames).
	static func body(for name: String, _ args: JSONValue) -> JSONValue {
		var object = ToolSchema.stripNulls(args).objectValue ?? [:]
		switch name {
		case "macFocusSet":
			return ["name": .string(object["enabled"] == true ? "TobyFocusOn" : "TobyFocusOff")]
		case "macWindowMinimizeApp", "macWindowUnminimizeApp":
			return ["name": object["appName"] ?? ""]
		case "completeReminder":
			if object["completed"] == nil { object["completed"] = true }
		case "searchCalendarEvents", "searchReminders", "searchContacts":
			let limit = min(200, max(1, object["limit"]?.intValue ?? 30))
			object["limit"] = .number(Double(limit))
		default:
			break
		}
		for (key, value) in object { if value.stringValue?.trimmingCharacters(in: .whitespaces).isEmpty == true { object.removeValue(forKey: key) } }
		return .object(object)
	}

	public func tools(dryRun: Bool) -> [ChatTool] {
		Self.definitions.map { definition in
			let bridge = bridge
			let name = definition.name
			return ChatTool(tool: Tool(name: name, description: definition.description, parameters: JSONSchema(definition.schema), readOnly: definition.readOnly) { args, _ in
				if name == "macNotificationsPeek" {
					return ["supported": false, "message": "Toby cannot list Notification Center items via a stable public API. To turn Do Not Disturb / Focus on or off, use macFocusSet instead."]
				}
				if dryRun, !definition.readOnly { return ["dryRun": true, "message": .string("Would run \(definition.title).")] }
				guard let endpoint = Self.endpoints[name] else { return ["error": .string("Unsupported tool \(name).")] }
				let response = await bridge.call(endpoint, Self.body(for: name, args))
				guard response["ok"] == true else {
					var failure: [String: JSONValue] = ["ok": false, "error": response["error"] ?? .string("\(definition.title) failed.")]
					if response["needsPermission"] == true { failure["needsPermission"] = true }
					return .object(failure)
				}
				return response["data"] ?? ["ok": true]
			}, title: definition.title, readOnly: definition.readOnly)
		}
	}

	// MARK: Feed summaries (DashboardItem shape)

	/// Strip Teams/Zoom/Meet join boilerplate from event notes (≤ 500 chars).
	public static func meetingNotes(_ raw: String?) -> String? {
		guard let raw else { return nil }
		let withoutBlocks = raw.replacing(/_{5,}[\s\S]*?_{5,}/, with: " ").replacing(/<[^>]+>/, with: " ")
		let noise = /(?i)(microsoft teams|join (the |this )?(meeting|call|zoom|webex|on your)|meeting id|passcode|password:|dial[- ]in|dial by your location|find (a|your) local number|viva insights|do not edit this section|video conferencing device|video id:|join with a video|learn more about teams|\[company logo\]|^more info$|privacy and security|one tap mobile|zoom\.us|teams\.microsoft|meet\.google|webex\.com|for organizers|meeting options|need help\?|https?:\/\/\S+$|^\+?[\d\s(),#*-]{8,}$|tel:|conference id|phone conference)/
		func keep(_ line: String) -> Bool {
			if line.isEmpty { return false }
			if line.wholeMatch(of: /[-_=*~:\s.]+/) != nil { return false }
			if line.prefixMatch(of: /\+?\d[\d\s(),#*-]{7,}/) != nil { return false }
			return line.firstMatch(of: noise) == nil
		}
		let lines: [String] = withoutBlocks.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
		let kept = lines.filter(keep).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
		return kept.isEmpty ? nil : String(kept.prefix(500))
	}

	/// Next 7 days of events with urgency (in progress / within an hour = high).
	public func upcomingEvents(limit: Int = 20, now: Date = Date()) async throws -> JSONValue {
		let data = try await bridge.data("calendar/search", [
			"dateFrom": .string(TodoRecurrence.isoString(now)), "dateTo": .string(TodoRecurrence.isoString(now.addingTimeInterval(7 * 86400))),
			"limit": .number(Double(min(200, max(1, limit)))),
		])
		var groups: [(id: String, count: Int)] = []
		let items: [JSONValue] = (data["events"]?.arrayValue ?? []).map { event in
			let calendar = event["calendar"]?.stringValue
			let location = event["location"]?.stringValue?.nilIfEmpty
			let start = event["startDate"]?.stringValue
			let end = event["endDate"]?.stringValue
			let allDay = event["isAllDay"] == true
			var urgency = "low"
			if let start, let startAt = TodoRecurrence.parseISO(start) {
				let endAt = end.flatMap(TodoRecurrence.parseISO)
				let inProgress = startAt <= now && (endAt.map { $0 > now } ?? false)
				let soon = startAt >= now && startAt.timeIntervalSince(now) <= 3600
				urgency = inProgress || soon ? "high" : (startAt.timeIntervalSince(now) <= 86400 ? "normal" : "low")
			}
			if let calendar {
				if let index = groups.firstIndex(where: { $0.id == calendar }) { groups[index].count += 1 } else { groups.append((calendar, 1)) }
			}
			var facts: [String: JSONValue] = ["allDay": .bool(allDay)]
			if let location { facts["location"] = .string(location) }
			if let notes = Self.meetingNotes(event["description"]?.stringValue) { facts["notes"] = .string(notes) }
			if let attendees = event["attendeeCount"], attendees.doubleValue != nil { facts["attendeeCount"] = attendees }
			if let recurring = event["isRecurring"]?.boolValue { facts["recurring"] = .bool(recurring) }
			let detail = location ?? (allDay ? "All day" : (end.map { "\(start ?? "") – \($0)" } ?? start))
			var item: [String: JSONValue] = ["id": event["uid"] ?? "", "title": event["summary"] ?? "", "urgency": .string(urgency), "event": .object(facts)]
			if let calendar { item["subtitle"] = .string(calendar); item["groupId"] = .string(calendar) }
			if let detail { item["detail"] = .string(detail) }
			if let start { item["timestamp"] = .string(start) }
			return .object(item)
		}
		return [
			"count": data["count"] ?? .number(Double(items.count)), "items": .array(items),
			"groups": .array(groups.map { ["id": .string($0.id), "label": .string($0.id), "count": .number(Double($0.count))] }),
			"generatedAt": .string(TodoRecurrence.isoString(now)), "launchUrl": "ical://",
		]
	}

	/// Open reminders with urgency (priority 1 or overdue = high).
	public func openReminders(limit: Int = 20, now: Date = Date()) async throws -> JSONValue {
		let data = try await bridge.data("reminders/search", ["completed": false, "limit": .number(Double(min(200, max(1, limit))))])
		var groups: [(id: String, count: Int)] = []
		let items: [JSONValue] = (data["reminders"]?.arrayValue ?? []).map { reminder in
			let id = reminder["id"]?.stringValue ?? ""
			let list = reminder["list"]?.stringValue
			let due = reminder["dueDate"]?.stringValue
			var urgency = reminder["priority"]?.intValue == 1 ? "high" : "normal"
			if let due, let dueAt = TodoRecurrence.parseISO(due), dueAt < now { urgency = "high" }
			if let list {
				if let index = groups.firstIndex(where: { $0.id == list }) { groups[index].count += 1 } else { groups.append((list, 1)) }
			}
			let escaped = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
			var item: [String: JSONValue] = ["id": .string(id), "title": reminder["title"] ?? "", "urgency": .string(urgency)]
			if !id.isEmpty { item["url"] = .string("x-apple-reminderkit://REMCDReminder/\(escaped)") } else if let url = reminder["url"]?.stringValue { item["url"] = .string(url) }
			if let list { item["subtitle"] = .string(list); item["groupId"] = .string(list) }
			if let notes = reminder["notes"]?.stringValue { item["detail"] = .string(notes) }
			if let due { item["timestamp"] = .string(due) }
			return .object(item)
		}
		return [
			"count": data["count"] ?? .number(Double(items.count)), "items": .array(items),
			"groups": .array(groups.map { ["id": .string($0.id), "label": .string($0.id), "count": .number(Double($0.count))] }),
			"generatedAt": .string(TodoRecurrence.isoString(now)),
		]
	}

	public func completeReminder(_ id: String) async throws {
		_ = try await bridge.data("reminders/complete", ["id": .string(id), "completed": true])
	}
}
