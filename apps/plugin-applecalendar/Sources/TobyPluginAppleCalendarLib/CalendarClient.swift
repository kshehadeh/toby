@preconcurrency import EventKit
import Foundation

public struct AppleCalendarSummary {
	public let name: String
	public let color: String

	func toDictionary() -> [String: Any] {
		["name": name, "color": color]
	}
}

public struct AppleCalendarEventSummary {
	public let uid: String
	public let summary: String
	public let startDate: Date
	public let endDate: Date
	public let isAllDay: Bool
	public let location: String
	public let description: String
	public let calendar: String

	func toDictionary() -> [String: Any] {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime]
		return [
			"uid": uid,
			"summary": summary,
			"startDate": formatter.string(from: startDate),
			"endDate": formatter.string(from: endDate),
			"isAllDay": isAllDay,
			"location": location,
			"description": description,
			"calendar": calendar,
		]
	}
}

public struct AppleCalendarEventDetail {
	public let uid: String
	public let summary: String
	public let startDate: Date
	public let endDate: Date
	public let isAllDay: Bool
	public let location: String
	public let description: String
	public let calendar: String
	public let attendees: [String]

	func toDetailDictionary() -> [String: Any] {
		var dict = AppleCalendarEventSummary(
			uid: uid,
			summary: summary,
			startDate: startDate,
			endDate: endDate,
			isAllDay: isAllDay,
			location: location,
			description: description,
			calendar: calendar
		).toDictionary()
		dict["attendees"] = attendees
		return dict
	}
}

public enum CalendarClient {
	public static var isPlatformSupported: Bool {
		#if os(macOS)
		return true
		#else
		return false
		#endif
	}

	private nonisolated(unsafe) static let store = EKEventStore()

	public static func testConnection() throws {
		guard isPlatformSupported else {
			throw CalendarFailure(message: "Apple Calendar is only available on macOS.")
		}

		// Try Toby.app native helper first
		if NativeHelperClient.ensureAvailable() {
			let response = NativeHelperClient.listCalendars()
			if response.ok, let data = response.data, let calendars = data["calendars"] as? [[String: Any]] {
				if calendars.isEmpty {
					throw CalendarFailure(message: "Calendar.app has no calendars configured.")
				}
				return
			}
			if response.needsPermission {
				throw CalendarFailure(message: "Calendar access denied. Grant Calendar access to Toby in System Settings > Privacy & Security > Calendars.")
			}
		}

		// Fall back to in-process EventKit + AppleScript
		let calendars: [AppleCalendarSummary]
		do {
			try ensureAccess()
			calendars = store.calendars(for: .event).map { cal in
				AppleCalendarSummary(name: cal.title, color: colorString(from: cal.cgColor))
			}
		} catch {
			calendars = fallbackListCalendarsAppleScript()
			if calendars.isEmpty {
				throw CalendarFailure(message: "Could not reach Calendar.app via EventKit (\(error.localizedDescription)) or AppleScript fallback.")
			}
		}
		if calendars.isEmpty {
			throw CalendarFailure(message: "Calendar.app has no calendars configured.")
		}
	}

	public static func validateTools() -> [[String: Any]] {
		var checks: [[String: Any]] = []
		guard isPlatformSupported else {
			return [[
				"tool": "searchCalendarEvents",
				"ok": false,
				"details": "Not on macOS.",
			]]
		}

		do {
			try ensureAccess()
			let sample = try searchCalendarEvents(SearchParams(limit: 1))
			checks.append([
				"tool": "searchCalendarEvents",
				"ok": true,
				"details": "Search completed (\(sample.count) match sample).",
			])
		} catch {
			checks.append([
				"tool": "searchCalendarEvents",
				"ok": false,
				"details": error.localizedDescription,
			])
		}

		do {
			try ensureAccess()
			let calendars = listCalendars()
			checks.append([
				"tool": "listCalendars",
				"ok": !calendars.isEmpty,
				"details": calendars.isEmpty
					? "No calendars returned (check Calendar.app)."
					: "Listed \(calendars.count) calendar(s).",
			])
		} catch {
			checks.append([
				"tool": "listCalendars",
				"ok": false,
				"details": error.localizedDescription,
			])
		}

		checks.append([
			"tool": "getCalendarEvent",
			"ok": true,
			"details": "Not executed; requires an event uid from searchCalendarEvents.",
		])
		checks.append([
			"tool": "createCalendarEvent",
			"ok": true,
			"details": "Not executed; event creation requires explicit user action in chat.",
		])
		checks.append([
			"tool": "updateCalendarEvent",
			"ok": true,
			"details":
				"Not executed; event updates require a uid from searchCalendarEvents or createCalendarEvent.",
		])
		checks.append([
			"tool": "deleteCalendarEvent",
			"ok": true,
			"details":
				"Not executed; event deletion requires a uid from searchCalendarEvents or createCalendarEvent.",
		])
		return checks
	}

	public struct SearchParams {
		public var query: String?
		public var calendar: String?
		public var dateFrom: String?
		public var dateTo: String?
		public var limit: Int = 30
	}

	public static func listCalendars() -> [AppleCalendarSummary] {
		guard isPlatformSupported else { return [] }

		// Try Toby.app native helper first
		if NativeHelperClient.ensureAvailable() {
			let response = NativeHelperClient.listCalendars()
			if response.ok, let data = response.data, let raw = data["calendars"] as? [[String: Any]] {
				return raw.compactMap { item in
					guard let name = item["name"] as? String else { return nil }
					return AppleCalendarSummary(name: name, color: (item["color"] as? String) ?? "")
				}
			}
		}

		// Fall back to in-process EventKit + AppleScript
		do {
			try ensureAccess()
		} catch {
			return fallbackListCalendarsAppleScript()
		}

		return store.calendars(for: .event).map { cal in
			AppleCalendarSummary(name: cal.title, color: colorString(from: cal.cgColor))
		}
	}

	public static func searchCalendarEvents(_ params: SearchParams) throws -> [AppleCalendarEventSummary] {
		guard isPlatformSupported else {
			throw CalendarFailure(message: "Apple Calendar is only available on macOS.")
		}

		// Try Toby.app native helper first
		if NativeHelperClient.ensureAvailable() {
			let response = NativeHelperClient.searchEvents(params)
			if response.ok, let data = response.data, let raw = data["events"] as? [[String: Any]] {
				return raw.compactMap { dictToEventSummary($0) }
			}
			if response.needsPermission {
				throw CalendarFailure(message: "Calendar access denied. Grant Calendar access to Toby in System Settings > Privacy & Security > Calendars.")
			}
			// If helper request failed for other reasons, fall through
		}

		// Fall back to in-process EventKit + AppleScript
		do {
			try ensureAccess()
		} catch {
			return try fallbackSearchCalendarEventsAppleScript(params, accessError: error)
		}

		let limit = min(max(1, params.limit), 200)
		let start = DateParser.searchRangeStart(params.dateFrom) ?? Date.distantPast
		let end = DateParser.searchRangeEnd(params.dateTo) ?? Date.distantFuture

		var calendars = store.calendars(for: .event)
		if let calendarName = trimmedOptional(params.calendar) {
			calendars = calendars.filter { $0.title == calendarName }
		}

		let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
		var events = store.events(matching: predicate)
		events.sort { $0.startDate < $1.startDate }

		if let query = trimmedOptional(params.query) {
			let needle = query.lowercased()
			events = events.filter { ($0.title ?? "").lowercased().contains(needle) }
		}

		return events.prefix(limit).compactMap { eventToSummary($0) }
	}

	public static func getCalendarEvent(uid: String, calendar: String?) -> Result<AppleCalendarEventDetail, CalendarFailure> {
		guard isPlatformSupported else {
			return .failure(CalendarFailure(message: "Apple Calendar is only available on macOS."))
		}

		// Try Toby.app native helper first
		if NativeHelperClient.ensureAvailable() {
			let response = NativeHelperClient.getEvent(uid: uid, calendar: calendar)
			if response.ok, let data = response.data {
				return .success(dictToEventDetail(data))
			}
			if let error = response.error {
				return .failure(CalendarFailure(message: error))
			}
		}

		// Fall back to in-process EventKit + AppleScript
		do {
			try ensureAccess()
		} catch {
			return .failure(CalendarFailure(message: error.localizedDescription))
		}

		if let event = store.event(withIdentifier: uid) {
			if let calendarName = trimmedOptional(calendar),
				event.calendar.title != calendarName
			{
				return .failure(CalendarFailure(message: "Event not found. Verify the uid and calendar."))
			}
			return .success(eventToDetail(event))
		}

		return fallbackGetEventAppleScript(uid: uid, calendar: calendar)
	}

	public struct CreateEventParams {
		public var summary: String
		public var startDate: String
		public var endDate: String
		public var calendar: String?
		public var location: String?
		public var description: String?
		public var allDay: Bool?
	}

	public static func createCalendarEvent(_ params: CreateEventParams) -> Result<String, CalendarFailure> {
		guard isPlatformSupported else {
			return .failure(CalendarFailure(message: "Apple Calendar is only available on macOS."))
		}

		// Try Toby.app native helper first
		if NativeHelperClient.ensureAvailable() {
			let response = NativeHelperClient.createEvent(params)
			if response.ok, let data = response.data, let uid = data["uid"] as? String {
				return .success(uid)
			}
			if let error = response.error {
				return .failure(CalendarFailure(message: error))
			}
		}

		// Fall back to in-process EventKit + AppleScript
		do {
			try ensureAccess()
			let start = try DateParser.parseUserDate(params.startDate)
			let end = try DateParser.parseUserDate(params.endDate)
			let targetCalendar = try resolveCalendar(named: params.calendar)

			let event = EKEvent(eventStore: store)
			event.title = params.summary
			event.startDate = start
			event.endDate = end
			event.isAllDay = params.allDay ?? false
			event.calendar = targetCalendar
			if let location = trimmedOptional(params.location) { event.location = location }
			if let notes = trimmedOptional(params.description) { event.notes = notes }

			try store.save(event, span: .thisEvent, commit: true)
			guard let uid = event.eventIdentifier else {
				return .failure(CalendarFailure(message: "Calendar.app returned an empty uid."))
			}
			return .success(uid)
		} catch let failure as CalendarFailure {
			return .failure(failure)
		} catch {
			return fallbackCreateEventAppleScript(params)
		}
	}

	public struct UpdateEventParams {
		public var uid: String
		public var calendar: String?
		public var summary: String?
		public var startDate: String?
		public var endDate: String?
		public var location: String?
		public var description: String?
		public var allDay: Bool?
	}

	public static func updateCalendarEvent(_ params: UpdateEventParams) -> Result<Void, CalendarFailure> {
		guard isPlatformSupported else {
			return .failure(CalendarFailure(message: "Apple Calendar is only available on macOS."))
		}

		let hasPatch = trimmedOptional(params.summary) != nil
			|| trimmedOptional(params.startDate) != nil
			|| trimmedOptional(params.endDate) != nil
			|| trimmedOptional(params.location) != nil
			|| trimmedOptional(params.description) != nil
			|| params.allDay != nil
		if !hasPatch {
			return .failure(CalendarFailure(
				message:
					"Provide at least one of summary, startDate, endDate, location, description, or allDay to update."
			))
		}

		// Try Toby.app native helper first
		if NativeHelperClient.ensureAvailable() {
			let response = NativeHelperClient.updateEvent(params)
			if response.ok {
				return .success(())
			}
			if let error = response.error {
				return .failure(CalendarFailure(message: error))
			}
		}

		// Fall back to in-process EventKit + AppleScript
		do {
			try ensureAccess()
			guard let event = store.event(withIdentifier: params.uid) else {
				return fallbackUpdateEventAppleScript(params)
			}
			if let calendarName = trimmedOptional(params.calendar),
				event.calendar.title != calendarName
			{
				return .failure(CalendarFailure(message: "Event not found. Verify the uid and calendar name."))
			}

			let savedStart = event.startDate
			let savedEnd = event.endDate

			if let summary = trimmedOptional(params.summary) { event.title = summary }
			if let startText = trimmedOptional(params.startDate) {
				event.startDate = try DateParser.parseUserDate(startText)
			}
			if let endText = trimmedOptional(params.endDate) {
				event.endDate = try DateParser.parseUserDate(endText)
			}
			if let location = trimmedOptional(params.location) { event.location = location }
			if let notes = trimmedOptional(params.description) { event.notes = notes }
			if let allDay = params.allDay { event.isAllDay = allDay }

			if trimmedOptional(params.startDate) == nil { event.startDate = savedStart }
			if trimmedOptional(params.endDate) == nil { event.endDate = savedEnd }

			try store.save(event, span: .thisEvent, commit: true)
			return .success(())
		} catch {
			return fallbackUpdateEventAppleScript(params)
		}
	}

	public static func deleteCalendarEvent(uid: String, calendar: String?) -> Result<Void, CalendarFailure> {
		guard isPlatformSupported else {
			return .failure(CalendarFailure(message: "Apple Calendar is only available on macOS."))
		}

		// Try Toby.app native helper first
		if NativeHelperClient.ensureAvailable() {
			let response = NativeHelperClient.deleteEvent(uid: uid, calendar: calendar)
			if response.ok {
				return .success(())
			}
			if let error = response.error {
				return .failure(CalendarFailure(message: error))
			}
		}

		// Fall back to in-process EventKit + AppleScript
		do {
			try ensureAccess()
			guard let event = store.event(withIdentifier: uid) else {
				return fallbackDeleteEventAppleScript(uid: uid, calendar: calendar)
			}
			if let calendarName = trimmedOptional(calendar),
				event.calendar.title != calendarName
			{
				return .failure(CalendarFailure(message: "Event not found. Verify the uid and calendar name."))
			}
			try store.remove(event, span: .thisEvent, commit: true)
			return .success(())
		} catch {
			return fallbackDeleteEventAppleScript(uid: uid, calendar: calendar)
		}
	}

	// MARK: - EventKit helpers

	private static func ensureAccess() throws {
		let sem = DispatchSemaphore(value: 0)
		final class AccessResult: @unchecked Sendable {
			var granted = false
			var error: Error?
		}
		let result = AccessResult()
		if #available(macOS 14.0, *) {
			store.requestFullAccessToEvents { ok, err in
				result.granted = ok
				result.error = err
				sem.signal()
			}
		} else {
			store.requestAccess(to: .event) { ok, err in
				result.granted = ok
				result.error = err
				sem.signal()
			}
		}
		sem.wait()
		if let error = result.error { throw error }
		if !result.granted {
			throw CalendarFailure(message: "Calendar access denied.")
		}
	}

	private static func resolveCalendar(named name: String?) throws -> EKCalendar {
		let calendars = store.calendars(for: .event)
		if let name = trimmedOptional(name) {
			guard let match = calendars.first(where: { $0.title == name }) else {
				throw CalendarFailure(message: "Calendar not found: \(name)")
			}
			return match
		}
		if let defaultCal = calendars.first {
			return defaultCal
		}
		throw CalendarFailure(message: "Calendar.app has no calendars configured.")
	}

	private static func eventToSummary(_ event: EKEvent) -> AppleCalendarEventSummary? {
		guard let uid = event.eventIdentifier else { return nil }
		return AppleCalendarEventSummary(
			uid: uid,
			summary: event.title ?? "",
			startDate: event.startDate,
			endDate: event.endDate,
			isAllDay: event.isAllDay,
			location: event.location ?? "",
			description: event.notes ?? "",
			calendar: event.calendar.title
		)
	}

	private static func eventToDetail(_ event: EKEvent) -> AppleCalendarEventDetail {
		let attendees = (event.attendees ?? []).compactMap { participant -> String? in
			if let name = participant.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
				return name
			}
			let url = participant.url.absoluteString
			return url.isEmpty ? nil : url
		}
		return AppleCalendarEventDetail(
			uid: event.eventIdentifier ?? "",
			summary: event.title ?? "",
			startDate: event.startDate,
			endDate: event.endDate,
			isAllDay: event.isAllDay,
			location: event.location ?? "",
			description: event.notes ?? "",
			calendar: event.calendar.title,
			attendees: attendees
		)
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

	private static func trimmedOptional(_ value: String?) -> String? {
		guard let value else { return nil }
		let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed.isEmpty ? nil : trimmed
	}

	// MARK: - AppleScript fallback

	private static func fallbackListCalendarsAppleScript() -> [AppleCalendarSummary] {
		let rowSep = "|||CALROW|||"
		let colSep = "|||CALCOL|||"
		let script = """
		tell application "Calendar"
		set outputText to ""
		repeat with cal in calendars
		try
		set calName to name of cal as string
		set calColor to ""
		try
		set calColor to (color of cal) as string
		end try
		if length of outputText > 0 then set outputText to outputText & "\(rowSep)"
		set outputText to outputText & calName & "\(colSep)" & calColor
		end try
		end repeat
		return outputText
		end tell
		"""
		let result = AppleScriptRunner.execute(script, timeoutMs: 20_000)
		guard result.success, !result.output.isEmpty else { return [] }
		return parseCalendarListOutput(result.output)
	}

	public static func parseCalendarListOutput(_ raw: String) -> [AppleCalendarSummary] {
		let rowSep = "|||CALROW|||"
		let colSep = "|||CALCOL|||"
		var out: [AppleCalendarSummary] = []
		for chunk in raw.components(separatedBy: rowSep) {
			let line = chunk.trimmingCharacters(in: .whitespacesAndNewlines)
			guard !line.isEmpty else { continue }
			let parts = line.components(separatedBy: colSep)
			guard let name = parts.first?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
				continue
			}
			let color = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : ""
			out.append(AppleCalendarSummary(name: name, color: color))
		}
		return out
	}

	private static func fallbackSearchCalendarEventsAppleScript(_ params: SearchParams, accessError: Error) throws -> [AppleCalendarEventSummary] {
		let rowSep = "|||EVTROW|||"
		let colSep = "|||EVTCOL|||"
		let limit = min(max(1, params.limit), 200)
		let safeQuery = AppleScriptRunner.escapeForAppleScript(trimmedOptional(params.query) ?? "")
		let safeCalendar = AppleScriptRunner.escapeForAppleScript(trimmedOptional(params.calendar) ?? "")
		let startFilter = DateParser.searchRangeStart(params.dateFrom).map { appleScriptDateLiteral($0) }
		let endFilter = DateParser.searchRangeEnd(params.dateTo).map { appleScriptDateLiteral($0) }
		let startBlock = startFilter.map {
			"if eventStart < date \"\(AppleScriptRunner.escapeForAppleScript($0))\" then set includeEvent to false"
		} ?? ""
		let endBlock = endFilter.map {
			"if eventStart is greater than or equal to date \"\(AppleScriptRunner.escapeForAppleScript($0))\" then set includeEvent to false"
		} ?? ""
		let script = """
		tell application "Calendar"
		try
		set outputText to ""
		set matchedCount to 0
		set targetCalendar to "\(safeCalendar)"
		set queryText to "\(safeQuery)"
		repeat with cal in calendars
		set calName to name of cal as string
		if targetCalendar is "" or calName is targetCalendar then
		repeat with evt in events of cal
		try
		set includeEvent to true
		set evtSummary to summary of evt as string
		set eventStart to start date of evt
		\(startBlock)
		\(endBlock)
		if queryText is not "" then
		ignoring case
		if evtSummary does not contain queryText then set includeEvent to false
		end ignoring
		end if
		if includeEvent then
		set evtUid to uid of evt as string
		set d to start date of evt
		set evtStartStr to ((year of d) as string) & "-" & ((month of d as integer) as string) & "-" & ((day of d) as string) & "-" & ((hours of d) as string) & "-" & ((minutes of d) as string) & "-" & ((seconds of d) as string)
		set d2 to end date of evt
		set evtEndStr to ((year of d2) as string) & "-" & ((month of d2 as integer) as string) & "-" & ((day of d2) as string) & "-" & ((hours of d2) as string) & "-" & ((minutes of d2) as string) & "-" & ((seconds of d2) as string)
		set evtAllDay to allday event of evt as string
		set evtLocation to ""
		try
		set evtLocation to location of evt
		end try
		set evtDescription to ""
		try
		set evtDescription to description of evt
		end try
		if length of outputText > 0 then set outputText to outputText & "\(rowSep)"
		set outputText to outputText & evtUid & "\(colSep)" & evtSummary & "\(colSep)" & evtStartStr & "\(colSep)" & evtEndStr & "\(colSep)" & evtAllDay & "\(colSep)" & evtLocation & "\(colSep)" & evtDescription & "\(colSep)" & calName
		set matchedCount to matchedCount + 1
		if matchedCount is greater than or equal to \(limit) then return outputText
		end if
		end try
		end repeat
		end if
		end repeat
		return outputText
		on error errMsg
		return "error:" & errMsg
		end try
		end tell
		"""
		let result = AppleScriptRunner.execute(script, timeoutMs: 60_000)
		guard result.success else {
			throw CalendarFailure(message: "EventKit access failed: \(accessError.localizedDescription). AppleScript fallback failed: \(result.error ?? "unknown error")")
		}
		let parsed = parseSearchEventsAppleScriptOutput(result.output)
		switch parsed {
		case let .success(events):
			return events
		case let .failure(error):
			throw CalendarFailure(message: "EventKit access failed: \(accessError.localizedDescription). AppleScript fallback failed: \(error.message)")
		}
	}

	private static func parseSearchEventsAppleScriptOutput(_ raw: String) -> Result<[AppleCalendarEventSummary], CalendarFailure> {
		let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed.isEmpty { return .success([]) }
		if trimmed.hasPrefix("error:") {
			return .failure(CalendarFailure(message: String(trimmed.dropFirst("error:".count)).trimmingCharacters(in: .whitespacesAndNewlines)))
		}
		let rowSep = "|||EVTROW|||"
		let colSep = "|||EVTCOL|||"
		var events: [AppleCalendarEventSummary] = []
		for row in trimmed.components(separatedBy: rowSep) {
			let parts = row.components(separatedBy: colSep)
			guard parts.count >= 8,
				let startDate = parseAppleScriptDate(parts[2]),
				let endDate = parseAppleScriptDate(parts[3])
			else {
				return .failure(CalendarFailure(message: "Unexpected Calendar.app response: \(row)"))
			}
			events.append(AppleCalendarEventSummary(
				uid: parts[0],
				summary: parts[1],
				startDate: startDate,
				endDate: endDate,
				isAllDay: parts[4] == "true",
				location: parts[5],
				description: parts[6],
				calendar: parts[7]
			))
		}
		return .success(events.sorted { $0.startDate < $1.startDate })
	}

	private static func appleScriptDateLiteral(_ date: Date) -> String {
		let formatter = DateFormatter()
		formatter.locale = Locale(identifier: "en_US_POSIX")
		formatter.dateFormat = "MMMM d, yyyy h:mm:ss a"
		return formatter.string(from: date)
	}

	private static func fallbackGetEventAppleScript(uid: String, calendar: String?) -> Result<AppleCalendarEventDetail, CalendarFailure> {
		let safeUid = AppleScriptRunner.escapeForAppleScript(uid)
		let attendeeSep = "|||ATTSEP|||"
		let colSep = "|||EVTCOL|||"
		let props = """
		set evtUid to uid of evt as string
		set evtSummary to summary of evt
		set d to start date of evt
		set evtStartStr to ((year of d) as string) & "-" & ((month of d as integer) as string) & "-" & ((day of d) as string) & "-" & ((hours of d) as string) & "-" & ((minutes of d) as string) & "-" & ((seconds of d) as string)
		set d2 to end date of evt
		set evtEndStr to ((year of d2) as string) & "-" & ((month of d2 as integer) as string) & "-" & ((day of d2) as string) & "-" & ((hours of d2) as string) & "-" & ((minutes of d2) as string) & "-" & ((seconds of d2) as string)
		set evtAllDay to allday event of evt as string
		set evtLocation to ""
		try
		set evtLocation to location of evt
		end try
		set evtDescription to ""
		try
		set evtDescription to description of evt
		end try
		set attText to ""
		try
		set atts to attendees of evt
		repeat with att in atts
		set attName to ""
		try
		set attName to display name of att
		end try
		if length of attText > 0 then set attText to attText & "\(attendeeSep)"
		set attText to attText & attName
		end repeat
		end try
		"""

		let script: String
		if let calendarName = trimmedOptional(calendar) {
			let safeCal = AppleScriptRunner.escapeForAppleScript(calendarName)
			script = """
			tell application "Calendar"
			try
			tell calendar "\(safeCal)"
			set matchingEvents to (events whose uid is "\(safeUid)")
			if (count of matchingEvents) > 0 then
			set evt to item 1 of matchingEvents
			\(props)
			return evtUid & "\(colSep)" & evtSummary & "\(colSep)" & evtStartStr & "\(colSep)" & evtEndStr & "\(colSep)" & evtAllDay & "\(colSep)" & evtLocation & "\(colSep)" & evtDescription & "\(colSep)" & (name of me as string) & "\(colSep)" & attText
			end if
			end tell
			return "not_found"
			on error errMsg
			return "error:" & errMsg
			end try
			end tell
			"""
		} else {
			script = """
			tell application "Calendar"
			try
			repeat with cal in calendars
			tell cal
			set matchingEvents to (events of cal whose uid is "\(safeUid)")
			if (count of matchingEvents) > 0 then
			set evt to item 1 of matchingEvents
			\(props)
			return evtUid & "\(colSep)" & evtSummary & "\(colSep)" & evtStartStr & "\(colSep)" & evtEndStr & "\(colSep)" & evtAllDay & "\(colSep)" & evtLocation & "\(colSep)" & evtDescription & "\(colSep)" & (name of cal as string) & "\(colSep)" & attText
			end if
			end tell
			end repeat
			return "not_found"
			on error errMsg
			return "error:" & errMsg
			end try
			end tell
			"""
		}

		return parseSingleEventAppleScriptResult(AppleScriptRunner.execute(script, timeoutMs: 30_000).output)
	}

	private static func fallbackCreateEventAppleScript(_ params: CreateEventParams) -> Result<String, CalendarFailure> {
		let safeSummary = AppleScriptRunner.escapeForAppleScript(params.summary)
		let startAsDate = DateParser.normalizeToAppleScriptDate(params.startDate)
		let endAsDate = DateParser.normalizeToAppleScriptDate(params.endDate)
		let allDayVal = (params.allDay ?? false) ? "true" : "false"
		var props = "summary:\"\(safeSummary)\", start date:date \"\(startAsDate)\", end date:date \"\(endAsDate)\", allday event:\(allDayVal)"
		if let location = trimmedOptional(params.location) {
			props += ", location:\"\(AppleScriptRunner.escapeForAppleScript(location))\""
		}
		if let description = trimmedOptional(params.description) {
			props += ", description:\"\(AppleScriptRunner.escapeForAppleScript(description))\""
		}

		let script: String
		if let calendarName = trimmedOptional(params.calendar) {
			let safeCal = AppleScriptRunner.escapeForAppleScript(calendarName)
			script = """
			tell application "Calendar"
			try
			tell calendar "\(safeCal)"
			set newEvent to make new event at end of events with properties {\(props)}
			set evtUid to uid of newEvent as string
			return evtUid
			end tell
			on error errMsg
			return "error:" & errMsg
			end try
			end tell
			"""
		} else {
			script = """
			tell application "Calendar"
			try
			set targetCal to item 1 of calendars
			set newEvent to make new event at end of events of targetCal with properties {\(props)}
			set evtUid to uid of newEvent as string
			return evtUid
			on error errMsg
			return "error:" & errMsg
			end try
			end tell
			"""
		}

		let result = AppleScriptRunner.execute(script, timeoutMs: 60_000)
		guard result.success else {
			return .failure(CalendarFailure(message: result.error ?? "Failed to create event."))
		}
		let uid = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
		if uid.hasPrefix("error:") {
			return .failure(CalendarFailure(message: String(uid.dropFirst("error:".count)).trimmingCharacters(in: .whitespacesAndNewlines)))
		}
		if uid.isEmpty {
			return .failure(CalendarFailure(message: "Calendar.app returned an empty uid."))
		}
		return .success(uid)
	}

	private static func fallbackUpdateEventAppleScript(_ params: UpdateEventParams) -> Result<Void, CalendarFailure> {
		let safeUid = AppleScriptRunner.escapeForAppleScript(params.uid)
		var setParts: [String] = []
		if let summary = trimmedOptional(params.summary) {
			setParts.append("set summary of evt to \"\(AppleScriptRunner.escapeForAppleScript(summary))\"")
		}
		if let startText = trimmedOptional(params.startDate) {
			let d = DateParser.normalizeToAppleScriptDate(startText)
			setParts.append("set start date of evt to date \"\(d)\"")
		}
		if let endText = trimmedOptional(params.endDate) {
			let d = DateParser.normalizeToAppleScriptDate(endText)
			setParts.append("set end date of evt to date \"\(d)\"")
		}
		if let location = trimmedOptional(params.location) {
			setParts.append("set location of evt to \"\(AppleScriptRunner.escapeForAppleScript(location))\"")
		}
		if let description = trimmedOptional(params.description) {
			setParts.append("set description of evt to \"\(AppleScriptRunner.escapeForAppleScript(description))\"")
		}
		if let allDay = params.allDay {
			setParts.append("set allday event of evt to \(allDay ? "true" : "false")")
		}

		let startProvided = trimmedOptional(params.startDate) != nil
		let endProvided = trimmedOptional(params.endDate) != nil
		var restoreStart = ""
		if !startProvided {
			restoreStart = """
			set d to current date
			set year of d to savedStartYear
			set month of d to savedStartMonth
			set day of d to savedStartDay
			set hours of d to savedStartHour
			set minutes of d to savedStartMinute
			set seconds of d to savedStartSecond
			set start date of evt to d
			"""
		}
		var restoreEnd = ""
		if !endProvided {
			restoreEnd = """
			set d2 to current date
			set year of d2 to savedEndYear
			set month of d2 to savedEndMonth
			set day of d2 to savedEndDay
			set hours of d2 to savedEndHour
			set minutes of d2 to savedEndMinute
			set seconds of d2 to savedEndSecond
			set end date of evt to d2
			"""
		}
		let restoreDates = """
		copy (start date of evt) to savedStartDate
		copy (end date of evt) to savedEndDate
		set savedStartYear to year of savedStartDate
		set savedStartMonth to month of savedStartDate as integer
		set savedStartDay to day of savedStartDate
		set savedStartHour to hours of savedStartDate
		set savedStartMinute to minutes of savedStartDate
		set savedStartSecond to seconds of savedStartDate
		set savedEndYear to year of savedEndDate
		set savedEndMonth to month of savedEndDate as integer
		set savedEndDay to day of savedEndDate
		set savedEndHour to hours of savedEndDate
		set savedEndMinute to minutes of savedEndDate
		set savedEndSecond to seconds of savedEndDate
		\(setParts.joined(separator: "\n"))
		\(restoreStart)
		\(restoreEnd)
		return "ok"
		"""

		let findBlock = """
		set matchingEvents to (events whose uid is "\(safeUid)")
		if (count of matchingEvents) > 0 then
		set evt to item 1 of matchingEvents
		\(restoreDates)
		end if
		"""

		let script: String
		if let calendarName = trimmedOptional(params.calendar) {
			let safeCal = AppleScriptRunner.escapeForAppleScript(calendarName)
			script = """
			tell application "Calendar"
			try
			tell calendar "\(safeCal)"
			\(findBlock)
			end tell
			return "not_found"
			on error errMsg
			return "error:" & errMsg
			end try
			end tell
			"""
		} else {
			script = """
			tell application "Calendar"
			try
			repeat with cal in calendars
			tell cal
			set matchingEvents to (events of cal whose uid is "\(safeUid)")
			if (count of matchingEvents) > 0 then
			set evt to item 1 of matchingEvents
			\(restoreDates)
			return "ok"
			end if
			end tell
			end repeat
			return "not_found"
			on error errMsg
			return "error:" & errMsg
			end try
			end tell
			"""
		}

		return parseSimpleAppleScriptResult(AppleScriptRunner.execute(script, timeoutMs: 60_000).output)
	}

	private static func fallbackDeleteEventAppleScript(uid: String, calendar: String?) -> Result<Void, CalendarFailure> {
		let safeUid = AppleScriptRunner.escapeForAppleScript(uid)
		let deleteBlock = """
		set matchingEvents to (events whose uid is "\(safeUid)")
		if (count of matchingEvents) > 0 then
		set evt to item 1 of matchingEvents
		delete evt
		return "ok"
		end if
		"""

		let script: String
		if let calendarName = trimmedOptional(calendar) {
			let safeCal = AppleScriptRunner.escapeForAppleScript(calendarName)
			script = """
			tell application "Calendar"
			try
			tell calendar "\(safeCal)"
			\(deleteBlock)
			end tell
			return "not_found"
			on error errMsg
			return "error:" & errMsg
			end try
			end tell
			"""
		} else {
			script = """
			tell application "Calendar"
			try
			repeat with cal in calendars
			tell cal
			set matchingEvents to (events of cal whose uid is "\(safeUid)")
			if (count of matchingEvents) > 0 then
			set evt to item 1 of matchingEvents
			delete evt
			return "ok"
			end if
			end tell
			end repeat
			return "not_found"
			on error errMsg
			return "error:" & errMsg
			end try
			end tell
			"""
		}

		return parseSimpleAppleScriptResult(AppleScriptRunner.execute(script, timeoutMs: 60_000).output)
	}

	private static func parseSingleEventAppleScriptResult(_ output: String) -> Result<AppleCalendarEventDetail, CalendarFailure> {
		let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed == "not_found" {
			return .failure(CalendarFailure(message: "Event not found. Verify the uid and calendar."))
		}
		if trimmed.hasPrefix("error:") {
			return .failure(CalendarFailure(message: String(trimmed.dropFirst("error:".count)).trimmingCharacters(in: .whitespacesAndNewlines)))
		}
		let colSep = "|||EVTCOL|||"
		let attendeeSep = "|||ATTSEP|||"
		let parts = trimmed.components(separatedBy: colSep)
		guard parts.count >= 8 else {
			return .failure(CalendarFailure(message: "Unexpected Calendar.app response: \(trimmed)"))
		}
		let attendees = (parts.count > 8 ? parts[8] : "")
			.components(separatedBy: attendeeSep)
			.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
			.filter { !$0.isEmpty }
		guard let startDate = parseAppleScriptDate(parts[2]),
			let endDate = parseAppleScriptDate(parts[3])
		else {
			return .failure(CalendarFailure(message: "Unexpected Calendar.app response: \(trimmed)"))
		}
		return .success(AppleCalendarEventDetail(
			uid: parts[0],
			summary: parts[1],
			startDate: startDate,
			endDate: endDate,
			isAllDay: parts[4] == "true",
			location: parts[5],
			description: parts[6],
			calendar: parts[7],
			attendees: attendees
		))
	}

	private static func parseSimpleAppleScriptResult(_ output: String) -> Result<Void, CalendarFailure> {
		let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed == "not_found" {
			return .failure(CalendarFailure(message: "Event not found. Verify the uid and calendar name."))
		}
		if trimmed.hasPrefix("error:") {
			return .failure(CalendarFailure(message: String(trimmed.dropFirst("error:".count)).trimmingCharacters(in: .whitespacesAndNewlines)))
		}
		if trimmed == "ok" { return .success(()) }
		return .failure(CalendarFailure(message: "Unexpected response: \(trimmed)"))
	}

	public static func parseAppleScriptDate(_ raw: String) -> Date? {
		let parts = raw.split(separator: "-").map(String.init)
		guard parts.count >= 6,
			let year = Int(parts[0]),
			let month = Int(parts[1]),
			let day = Int(parts[2]),
			let hour = Int(parts[3]),
			let minute = Int(parts[4]),
			let second = Int(parts[5])
		else { return nil }
		var components = DateComponents()
		components.year = year
		components.month = month
		components.day = day
		components.hour = hour
		components.minute = minute
		components.second = second
		return Calendar.current.date(from: components)
	}

	// MARK: - Native helper dict conversion

	private static func dictToEventSummary(_ dict: [String: Any]) -> AppleCalendarEventSummary? {
		guard let uid = dict["uid"] as? String,
			let summary = dict["summary"] as? String,
			let startDateStr = dict["startDate"] as? String,
			let endDateStr = dict["endDate"] as? String,
			let startDate = parseISO8601Date(startDateStr),
			let endDate = parseISO8601Date(endDateStr)
		else { return nil }
		return AppleCalendarEventSummary(
			uid: uid,
			summary: summary,
			startDate: startDate,
			endDate: endDate,
			isAllDay: dict["isAllDay"] as? Bool ?? false,
			location: dict["location"] as? String ?? "",
			description: dict["description"] as? String ?? "",
			calendar: dict["calendar"] as? String ?? ""
		)
	}

	private static func dictToEventDetail(_ dict: [String: Any]) -> AppleCalendarEventDetail {
		let attendees = (dict["attendees"] as? [String]) ?? []
		return AppleCalendarEventDetail(
			uid: dict["uid"] as? String ?? "",
			summary: dict["summary"] as? String ?? "",
			startDate: parseISO8601Date(dict["startDate"] as? String ?? "") ?? Date(),
			endDate: parseISO8601Date(dict["endDate"] as? String ?? "") ?? Date(),
			isAllDay: dict["isAllDay"] as? Bool ?? false,
			location: dict["location"] as? String ?? "",
			description: dict["description"] as? String ?? "",
			calendar: dict["calendar"] as? String ?? "",
			attendees: attendees
		)
	}

	private static func parseISO8601Date(_ string: String) -> Date? {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		if let date = formatter.date(from: string) { return date }
		formatter.formatOptions = [.withInternetDateTime]
		return formatter.date(from: string)
	}
}
