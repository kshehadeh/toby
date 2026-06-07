import Foundation

public enum CalendarTools {
	public static var definitions: [[String: Any]] {
		[
			tool(
				name: "listCalendars",
				description:
					"List Calendar.app calendar names and colors. Use exact calendar names when passing the `calendar` parameter to searchCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, or getCalendarEvent.",
				readOnly: true,
				properties: [:]
			),
			tool(
				name: "searchCalendarEvents",
				description:
					"Search Apple Calendar locally via Calendar.app. Returns event uid, summary, start/end dates, allDay, location, description, and calendar name. Use uid values for getCalendarEvent, updateCalendarEvent, and deleteCalendarEvent.",
				readOnly: true,
				properties: [
					"query": prop("string", "Match text in event summary", optional: true),
					"calendar": prop("string", "Calendar name to search. Omit to search all calendars.", optional: true),
					"dateFrom": prop("string", "Start date filter, e.g. 2026-01-15 or January 15, 2026. ISO 8601 or natural language accepted.", optional: true),
					"dateTo": prop("string", "End date filter, e.g. 2026-01-20 or January 20, 2026. ISO 8601 or natural language accepted.", optional: true),
					"limit": prop("number", "Max results (default 30, max 200)", optional: true),
				]
			),
			tool(
				name: "getCalendarEvent",
				description:
					"Get full details of a single Calendar.app event by uid, including attendee names. Use uid from searchCalendarEvents or createCalendarEvent.",
				readOnly: true,
				properties: [
					"uid": prop("string", "Event uid"),
					"calendar": prop("string", "Calendar name to limit the search. Omit to search all calendars.", optional: true),
				],
				required: ["uid"]
			),
			tool(
				name: "createCalendarEvent",
				description:
					"Create a new event in Calendar.app. Returns uid for later updateCalendarEvent or deleteCalendarEvent. Dates should be ISO 8601 (e.g. 2026-01-15T09:00:00).",
				properties: [
					"summary": prop("string", "Event title/summary"),
					"startDate": prop("string", "Start date/time in ISO 8601 format"),
					"endDate": prop("string", "End date/time in ISO 8601 format"),
					"calendar": prop("string", "Calendar name. Omit to use the default calendar.", optional: true),
					"location": prop("string", "Event location", optional: true),
					"description": prop("string", "Event description/notes", optional: true),
					"allDay": prop("boolean", "True for an all-day event (start/end dates are date-only)", optional: true),
				],
				required: ["summary", "startDate", "endDate"]
			),
			tool(
				name: "updateCalendarEvent",
				description:
					"Update an existing Calendar.app event by uid (from searchCalendarEvents or createCalendarEvent). Only provided fields are changed.",
				properties: [
					"uid": prop("string", "Event uid"),
					"calendar": prop("string", "Calendar name where the event lives. Omit to search all calendars.", optional: true),
					"summary": prop("string", "New event title", optional: true),
					"startDate": prop("string", "New start date/time in ISO 8601 format", optional: true),
					"endDate": prop("string", "New end date/time in ISO 8601 format", optional: true),
					"location": prop("string", "New location", optional: true),
					"description": prop("string", "New description/notes", optional: true),
					"allDay": prop("boolean", "Change all-day status", optional: true),
				],
				required: ["uid"]
			),
			tool(
				name: "deleteCalendarEvent",
				description:
					"Delete a Calendar.app event by uid (from searchCalendarEvents or createCalendarEvent). This cannot be undone.",
				properties: [
					"uid": prop("string", "Event uid"),
					"calendar": prop("string", "Calendar name where the event lives. Omit to search all calendars.", optional: true),
				],
				required: ["uid"]
			),
		]
	}

	public struct ExecuteResult {
		public let result: [String: Any]
		public let appliedActions: [String]
	}

	public static func execute(
		tool name: String,
		input: [String: Any],
		dryRun: Bool,
		maxResults: Int? = nil
	) -> Result<ExecuteResult, CalendarFailure> {
		guard CalendarClient.isPlatformSupported else {
			if name == "listCalendars" {
				return .success(ExecuteResult(
					result: ["error": "Apple Calendar tools only run on macOS.", "calendars": []],
					appliedActions: []
				))
			}
			if name == "searchCalendarEvents" {
				return .success(ExecuteResult(
					result: ["error": "Apple Calendar tools only run on macOS.", "events": []],
					appliedActions: []
				))
			}
			return .success(ExecuteResult(result: ["error": "Apple Calendar tools only run on macOS."], appliedActions: []))
		}

		switch name {
		case "listCalendars":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would list Calendar.app calendars."], appliedActions: []))
			}
			let calendars = CalendarClient.listCalendars()
			return .success(ExecuteResult(
				result: ["count": calendars.count, "calendars": calendars.map { $0.toDictionary() }],
				appliedActions: []
			))

		case "searchCalendarEvents":
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would search Apple Calendar with the given filters."], appliedActions: []))
			}
			let cap = min(max(1, intValue(input["limit"]) ?? maxResults ?? 30), 200)
			let events = CalendarClient.searchCalendarEvents(CalendarClient.SearchParams(
				query: stringValue(input["query"]),
				calendar: stringValue(input["calendar"]),
				dateFrom: stringValue(input["dateFrom"]),
				dateTo: stringValue(input["dateTo"]),
				limit: cap
			))
			return .success(ExecuteResult(
				result: ["count": events.count, "events": events.map { $0.toDictionary() }],
				appliedActions: []
			))

		case "getCalendarEvent":
			guard let uid = stringValue(input["uid"]), !uid.isEmpty else {
				return .failure(CalendarFailure(message: "uid is required."))
			}
			if dryRun {
				return .success(ExecuteResult(result: ["dryRun": true, "message": "Would get event uid \(uid)."], appliedActions: []))
			}
			switch CalendarClient.getCalendarEvent(uid: uid, calendar: stringValue(input["calendar"])) {
			case let .success(detail):
				return .success(ExecuteResult(result: detail.toDetailDictionary(), appliedActions: []))
			case let .failure(error):
				return .success(ExecuteResult(result: ["error": error.message], appliedActions: []))
			}

		case "createCalendarEvent":
			guard let summary = stringValue(input["summary"]), !summary.isEmpty,
				let startDate = stringValue(input["startDate"]), !startDate.isEmpty,
				let endDate = stringValue(input["endDate"]), !endDate.isEmpty
			else {
				return .failure(CalendarFailure(message: "summary, startDate, and endDate are required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would create event \"\(summary)\" on \(startDate)"
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			switch CalendarClient.createCalendarEvent(CalendarClient.CreateEventParams(
				summary: summary,
				startDate: startDate,
				endDate: endDate,
				calendar: stringValue(input["calendar"]),
				location: stringValue(input["location"]),
				description: stringValue(input["description"]),
				allDay: boolValue(input["allDay"])
			)) {
			case let .success(uid):
				let line = "Created event \"\(summary)\" (uid \(uid))"
				return .success(ExecuteResult(
					result: ["success": true, "uid": uid, "summary": summary],
					appliedActions: [line]
				))
			case let .failure(error):
				return .success(ExecuteResult(result: ["error": error.message], appliedActions: []))
			}

		case "updateCalendarEvent":
			guard let uid = stringValue(input["uid"]), !uid.isEmpty else {
				return .failure(CalendarFailure(message: "uid is required."))
			}
			let hasPatch = input["summary"] != nil || input["startDate"] != nil || input["endDate"] != nil
				|| input["location"] != nil || input["description"] != nil || input["allDay"] != nil
			if !hasPatch {
				return .success(ExecuteResult(
					result: ["error": "Provide at least one of summary, startDate, endDate, location, description, or allDay to update."],
					appliedActions: []
				))
			}
			if dryRun {
				let msg = "[DRY RUN] Would update event uid \(uid)"
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			switch CalendarClient.updateCalendarEvent(CalendarClient.UpdateEventParams(
				uid: uid,
				calendar: stringValue(input["calendar"]),
				summary: stringValue(input["summary"]),
				startDate: stringValue(input["startDate"]),
				endDate: stringValue(input["endDate"]),
				location: stringValue(input["location"]),
				description: stringValue(input["description"]),
				allDay: boolValue(input["allDay"])
			)) {
			case .success:
				let line = "Updated event uid \(uid)."
				return .success(ExecuteResult(result: ["success": true, "uid": uid], appliedActions: [line]))
			case let .failure(error):
				return .success(ExecuteResult(result: ["error": error.message], appliedActions: []))
			}

		case "deleteCalendarEvent":
			guard let uid = stringValue(input["uid"]), !uid.isEmpty else {
				return .failure(CalendarFailure(message: "uid is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would delete event uid \(uid)"
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			switch CalendarClient.deleteCalendarEvent(uid: uid, calendar: stringValue(input["calendar"])) {
			case .success:
				let line = "Deleted event uid \(uid)."
				return .success(ExecuteResult(result: ["success": true, "uid": uid], appliedActions: [line]))
			case let .failure(error):
				return .success(ExecuteResult(result: ["error": error.message], appliedActions: []))
			}

		default:
			return .failure(CalendarFailure(message: "Unknown tool: \(name)"))
		}
	}

	private static func tool(
		name: String,
		description: String,
		readOnly: Bool = false,
		properties: [String: Any],
		required: [String] = []
	) -> [String: Any] {
		var schema: [String: Any] = [
			"type": "object",
			"properties": properties,
		]
		if !required.isEmpty {
			schema["required"] = required
		}
		var def: [String: Any] = [
			"name": name,
			"description": description,
			"inputSchema": schema,
		]
		if readOnly { def["readOnly"] = true }
		return def
	}

	private static func prop(_ type: String, _ description: String, optional: Bool = false) -> [String: Any] {
		["type": type, "description": description]
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
}
