import EventKit
import Foundation

@MainActor
enum NativeCalendarHandler {
	private static let store = EKEventStore()

	// MARK: - Access

	static func requestAccess() -> Data {
		Task {
			let granted = await ensureAccessAsync()
			// Response is returned by the caller; this just triggers the prompt
			_ = granted
		}
		// Return immediately - the prompt will show and subsequent calls will use the granted access
		return json(["ok": true, "data": ["prompted": true]])
	}

	// MARK: - List calendars

	static func listCalendars() async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Calendar access denied.", "needsPermission": true])
		}
		let calendars = store.calendars(for: .event).map { cal -> [String: Any] in
			["name": cal.title, "color": colorString(from: cal.cgColor)]
		}
		return json(["ok": true, "data": ["calendars": calendars, "count": calendars.count]])
	}

	// MARK: - Search events

	static func searchEvents(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Calendar access denied.", "needsPermission": true])
		}
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
		else {
			return json(["ok": false, "error": "Invalid JSON body."])
		}

		let limit = min(max(intValue(input["limit"]) ?? 30, 1), 200)
		let start = dateFromInput(input["dateFrom"]) ?? Date.distantPast
		let end = dateToInput(input["dateTo"]) ?? Date.distantFuture

		var calendars = store.calendars(for: .event)
		if let calendarName = stringValue(input["calendar"]), !calendarName.isEmpty {
			calendars = calendars.filter { $0.title == calendarName }
		}

		let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
		var events = store.events(matching: predicate)
		events.sort { $0.startDate < $1.startDate }

		if let query = stringValue(input["query"]), !query.isEmpty {
			let needle = query.lowercased()
			events = events.filter { ($0.title ?? "").lowercased().contains(needle) }
		}

		let result = events.prefix(limit).compactMap { eventToDict($0) }
		return json(["ok": true, "data": ["events": result, "count": result.count]])
	}

	// MARK: - Get event

	static func getEvent(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Calendar access denied.", "needsPermission": true])
		}
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let uid = stringValue(input["uid"]), !uid.isEmpty
		else {
			return json(["ok": false, "error": "uid is required."])
		}

		guard let event = store.event(withIdentifier: uid) else {
			return json(["ok": false, "error": "Event not found. Verify the uid and calendar."])
		}

		if let calendarName = stringValue(input["calendar"]),
			!calendarName.isEmpty,
			event.calendar.title != calendarName
		{
			return json(["ok": false, "error": "Event not found. Verify the uid and calendar."])
		}

		var detail = eventToDict(event)
		let attendees = (event.attendees ?? []).compactMap { participant -> String? in
			if let name = participant.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
				return name
			}
			let url = participant.url.absoluteString
			return url.isEmpty ? nil : url
		}
		detail["attendees"] = attendees
		return json(["ok": true, "data": detail])
	}

	// MARK: - Create event

	static func createEvent(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Calendar access denied.", "needsPermission": true])
		}
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let summary = stringValue(input["summary"]), !summary.isEmpty,
			let startDateStr = stringValue(input["startDate"]), !startDateStr.isEmpty,
			let endDateStr = stringValue(input["endDate"]), !endDateStr.isEmpty
		else {
			return json(["ok": false, "error": "summary, startDate, and endDate are required."])
		}

		guard let startDate = parseISODate(startDateStr),
			let endDate = parseISODate(endDateStr)
		else {
			return json(["ok": false, "error": "Invalid date format. Use ISO 8601 (e.g. 2026-01-15T09:00:00)."])
		}

		let targetCalendar: EKCalendar
		do {
			targetCalendar = try resolveCalendar(named: stringValue(input["calendar"]))
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}

		let event = EKEvent(eventStore: store)
		event.title = summary
		event.startDate = startDate
		event.endDate = endDate
		event.isAllDay = boolValue(input["allDay"]) ?? false
		event.calendar = targetCalendar
		if let location = stringValue(input["location"]), !location.isEmpty { event.location = location }
		if let notes = stringValue(input["description"]), !notes.isEmpty { event.notes = notes }

		do {
			try store.save(event, span: .thisEvent, commit: true)
			guard let uid = event.eventIdentifier else {
				return json(["ok": false, "error": "Calendar.app returned an empty uid."])
			}
			return json(["ok": true, "data": ["uid": uid, "summary": summary]])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	// MARK: - Update event

	static func updateEvent(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Calendar access denied.", "needsPermission": true])
		}
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let uid = stringValue(input["uid"]), !uid.isEmpty
		else {
			return json(["ok": false, "error": "uid is required."])
		}

		guard let event = store.event(withIdentifier: uid) else {
			return json(["ok": false, "error": "Event not found. Verify the uid."])
		}

		if let calendarName = stringValue(input["calendar"]),
			!calendarName.isEmpty,
			event.calendar.title != calendarName
		{
			return json(["ok": false, "error": "Event not found. Verify the uid and calendar."])
		}

		if let summary = stringValue(input["summary"]) { event.title = summary }
		if let startText = stringValue(input["startDate"]), let date = parseISODate(startText) {
			event.startDate = date
		}
		if let endText = stringValue(input["endDate"]), let date = parseISODate(endText) {
			event.endDate = date
		}
		if let location = stringValue(input["location"]) { event.location = location }
		if let notes = stringValue(input["description"]) { event.notes = notes }
		if let allDay = input["allDay"] as? Bool { event.isAllDay = allDay }

		do {
			try store.save(event, span: .thisEvent, commit: true)
			return json(["ok": true, "data": ["uid": uid]])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	// MARK: - Delete event

	static func deleteEvent(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Calendar access denied.", "needsPermission": true])
		}
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let uid = stringValue(input["uid"]), !uid.isEmpty
		else {
			return json(["ok": false, "error": "uid is required."])
		}

		guard let event = store.event(withIdentifier: uid) else {
			return json(["ok": false, "error": "Event not found. Verify the uid."])
		}

		do {
			try store.remove(event, span: .thisEvent, commit: true)
			return json(["ok": true, "data": ["uid": uid]])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	// MARK: - Helpers

	private static func ensureAccessAsync() async -> Bool {
		// Check current status first - don't re-prompt if already granted
		if #available(macOS 14.0, *) {
			if EKEventStore.authorizationStatus(for: .event) == .fullAccess {
				return true
			}
			return await withCheckedContinuation { continuation in
				store.requestFullAccessToEvents { granted, _ in
					continuation.resume(returning: granted)
				}
			}
		} else {
			if EKEventStore.authorizationStatus(for: .event) == .authorized {
				return true
			}
			return await withCheckedContinuation { continuation in
				store.requestAccess(to: .event) { granted, _ in
					continuation.resume(returning: granted)
				}
			}
		}
	}

	private static func resolveCalendar(named name: String?) throws -> EKCalendar {
		let calendars = store.calendars(for: .event)
		if let name, !name.isEmpty {
			guard let match = calendars.first(where: { $0.title == name }) else {
				throw NSError(domain: "NativeCalendar", code: 1, userInfo: [
					NSLocalizedDescriptionKey: "Calendar not found: \(name)",
				])
			}
			return match
		}
		if let defaultCal = calendars.first { return defaultCal }
		throw NSError(domain: "NativeCalendar", code: 2, userInfo: [
			NSLocalizedDescriptionKey: "Calendar.app has no calendars configured.",
		])
	}

	private static func eventToDict(_ event: EKEvent) -> [String: Any] {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime]
		return [
			"uid": event.eventIdentifier ?? "",
			"summary": event.title ?? "",
			"startDate": formatter.string(from: event.startDate),
			"endDate": formatter.string(from: event.endDate),
			"isAllDay": event.isAllDay,
			"location": event.location ?? "",
			"description": event.notes ?? "",
			"calendar": event.calendar.title,
		]
	}

	private static func colorString(from cgColor: CGColor?) -> String {
		guard let cgColor, let components = cgColor.components else { return "" }
		if components.count >= 3 {
			let r = Int((components[0] * 255).rounded())
			let g = Int((components[1] * 255).rounded())
			let b = Int((components[2] * 255).rounded())
			return "rgb(\(r),\(g),\(b))"
		}
		return ""
	}

	private static func parseISODate(_ string: String) -> Date? {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		if let date = formatter.date(from: string) { return date }
		formatter.formatOptions = [.withInternetDateTime]
		return formatter.date(from: string)
	}

	private static func dateFromInput(_ value: Any?) -> Date? {
		guard let string = stringValue(value), !string.isEmpty else { return nil }
		if let date = parseISODate(string) { return date }
		return DateParserSearch.rangeStart(string)
	}

	private static func dateToInput(_ value: Any?) -> Date? {
		guard let string = stringValue(value), !string.isEmpty else { return nil }
		if let date = parseISODate(string) { return date }
		return DateParserSearch.rangeEnd(string)
	}

	private static func stringValue(_ value: Any?) -> String? {
		if let s = value as? String { return s }
		if let n = value as? NSNumber { return n.stringValue }
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

	private static func json(_ payload: [String: Any]) -> Data {
		guard JSONSerialization.isValidJSONObject(payload),
			let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
		else {
			return Data("{\"ok\":false,\"error\":\"encoding error\"}".utf8)
		}
		return data
	}
}

/// Minimal date parsing for search ranges, mirroring the plugin's DateParser logic.
enum DateParserSearch {
	static func rangeStart(_ input: String) -> Date? {
		let detector: NSDataDetector
		guard let d = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue) else { return nil }
		detector = d
		let range = NSRange(input.startIndex..., in: input)
		guard let match = detector.firstMatch(in: input, range: range),
			let date = match.date
		else { return nil }
		return Calendar.current.startOfDay(for: date)
	}

	static func rangeEnd(_ input: String) -> Date? {
		let detector: NSDataDetector
		guard let d = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue) else { return nil }
		detector = d
		let range = NSRange(input.startIndex..., in: input)
		guard let match = detector.firstMatch(in: input, range: range),
			let date = match.date
		else { return nil }
		let startOfDay = Calendar.current.startOfDay(for: date)
		return Calendar.current.date(byAdding: .day, value: 1, to: startOfDay)
	}
}
