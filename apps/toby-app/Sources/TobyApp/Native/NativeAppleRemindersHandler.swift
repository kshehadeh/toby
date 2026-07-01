import EventKit
import Foundation

@MainActor
enum NativeAppleRemindersHandler {
	private static let store = EKEventStore()

	private struct ReminderFetchResult: @unchecked Sendable {
		let reminders: [EKReminder]
	}

	// MARK: - Access

	static func requestAccess() async -> Data {
		let granted = await ensureAccessAsync()
		if granted {
			return json(["ok": true, "data": ["prompted": true, "granted": true]])
		}
		return json([
			"ok": false,
			"error": "Reminders access denied.",
			"needsPermission": true,
			"data": ["prompted": true, "granted": false],
		])
	}

	// MARK: - List reminder lists

	static func listReminderLists() async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Reminders access denied.", "needsPermission": true])
		}
		let lists = store.calendars(for: .reminder).map { list -> [String: Any] in
			["name": list.title, "color": colorString(from: list.cgColor)]
		}
		return json(["ok": true, "data": ["lists": lists, "count": lists.count]])
	}

	// MARK: - Search reminders

	static func searchReminders(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Reminders access denied.", "needsPermission": true])
		}
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
		else {
			return json(["ok": false, "error": "Invalid JSON body."])
		}

		let limit = min(max(intValue(input["limit"]) ?? 30, 1), 200)
		var lists = store.calendars(for: .reminder)
		if let listName = stringValue(input["list"]), !listName.isEmpty {
			lists = lists.filter { $0.title == listName }
		}

		let hasCompletedRange = stringValue(input["completedFrom"]) != nil || stringValue(input["completedTo"]) != nil
		let completed = boolValue(input["completed"]) ?? hasCompletedRange
		let predicate: NSPredicate
		if completed {
			let start = dateFromInput(input["completedFrom"])
			let end = dateToInput(input["completedTo"])
			predicate = store.predicateForCompletedReminders(withCompletionDateStarting: start, ending: end, calendars: lists)
		} else {
			let start = dateFromInput(input["dueFrom"])
			let end = dateToInput(input["dueTo"])
			predicate = store.predicateForIncompleteReminders(withDueDateStarting: start, ending: end, calendars: lists)
		}

		var reminders = await fetchReminders(matching: predicate)
		if let query = stringValue(input["query"]), !query.isEmpty {
			let needle = query.lowercased()
			reminders = reminders.filter { reminder in
				(reminder.title ?? "").lowercased().contains(needle)
					|| (reminder.notes ?? "").lowercased().contains(needle)
			}
		}
		reminders.sort { lhs, rhs in
			if completed {
				let left = lhs.completionDate ?? Date.distantPast
				let right = rhs.completionDate ?? Date.distantPast
				if left != right { return left > right }
			} else {
				let left = date(from: lhs.dueDateComponents) ?? Date.distantFuture
				let right = date(from: rhs.dueDateComponents) ?? Date.distantFuture
				if left != right { return left < right }
			}
			return (lhs.title ?? "") < (rhs.title ?? "")
		}

		let result = reminders.prefix(limit).map { reminderToDict($0) }
		return json(["ok": true, "data": ["reminders": Array(result), "count": result.count]])
	}

	// MARK: - Get reminder

	static func getReminder(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Reminders access denied.", "needsPermission": true])
		}
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let id = stringValue(input["id"]), !id.isEmpty
		else {
			return json(["ok": false, "error": "id is required."])
		}

		guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
			return json(["ok": false, "error": "Reminder not found. Verify the id and list."])
		}

		if let listName = stringValue(input["list"]),
			!listName.isEmpty,
			reminder.calendar.title != listName
		{
			return json(["ok": false, "error": "Reminder not found. Verify the id and list."])
		}

		return json(["ok": true, "data": reminderToDict(reminder)])
	}

	// MARK: - Create reminder

	static func createReminder(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Reminders access denied.", "needsPermission": true])
		}
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let title = stringValue(input["title"]), !title.isEmpty
		else {
			return json(["ok": false, "error": "title is required."])
		}

		let targetList: EKCalendar
		do {
			targetList = try resolveList(named: stringValue(input["list"]))
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}

		let reminder = EKReminder(eventStore: store)
		reminder.title = title
		reminder.calendar = targetList
		if let notes = stringValue(input["notes"]) { reminder.notes = notes }
		if let dueText = stringValue(input["dueDate"]), !dueText.isEmpty {
			guard let dueDate = parseISODate(dueText) else {
				return json(["ok": false, "error": "Invalid dueDate format. Use ISO 8601 (e.g. 2026-01-15T09:00:00)."])
			}
			reminder.dueDateComponents = dateComponents(from: dueDate)
		}
		if let priority = intValue(input["priority"]) {
			guard isValidPriority(priority) else {
				return json(["ok": false, "error": "Invalid priority. Use 0, 1, 5, or 9."])
			}
			reminder.priority = priority
		}
		if let urlText = stringValue(input["url"]), !urlText.isEmpty {
			reminder.url = URL(string: urlText)
		}

		do {
			try store.save(reminder, commit: true)
			return json(["ok": true, "data": reminderToDict(reminder)])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	// MARK: - Update reminder

	static func updateReminder(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Reminders access denied.", "needsPermission": true])
		}
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let id = stringValue(input["id"]), !id.isEmpty
		else {
			return json(["ok": false, "error": "id is required."])
		}

		guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
			return json(["ok": false, "error": "Reminder not found. Verify the id."])
		}

		if let title = stringValue(input["title"]) { reminder.title = title }
		if let notes = stringValue(input["notes"]) { reminder.notes = notes }
		if let listName = stringValue(input["list"]), !listName.isEmpty {
			do {
				reminder.calendar = try resolveList(named: listName)
			} catch {
				return json(["ok": false, "error": error.localizedDescription])
			}
		}
		if let dueText = stringValue(input["dueDate"]) {
			if dueText.isEmpty {
				reminder.dueDateComponents = nil
			} else if let dueDate = parseISODate(dueText) {
				reminder.dueDateComponents = dateComponents(from: dueDate)
			} else {
				return json(["ok": false, "error": "Invalid dueDate format. Use ISO 8601 (e.g. 2026-01-15T09:00:00)."])
			}
		}
		if let priority = intValue(input["priority"]) {
			guard isValidPriority(priority) else {
				return json(["ok": false, "error": "Invalid priority. Use 0, 1, 5, or 9."])
			}
			reminder.priority = priority
		}
		if let urlText = stringValue(input["url"]) {
			reminder.url = urlText.isEmpty ? nil : URL(string: urlText)
		}

		do {
			try store.save(reminder, commit: true)
			return json(["ok": true, "data": reminderToDict(reminder)])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	// MARK: - Complete reminder

	static func completeReminder(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Reminders access denied.", "needsPermission": true])
		}
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let id = stringValue(input["id"]), !id.isEmpty
		else {
			return json(["ok": false, "error": "id is required."])
		}

		guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
			return json(["ok": false, "error": "Reminder not found. Verify the id."])
		}

		let completed = boolValue(input["completed"]) ?? true
		reminder.isCompleted = completed
		reminder.completionDate = completed ? Date() : nil

		do {
			try store.save(reminder, commit: true)
			return json(["ok": true, "data": reminderToDict(reminder)])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	// MARK: - Delete reminder

	static func deleteReminder(body: Data?) async -> Data {
		guard await ensureAccessAsync() else {
			return json(["ok": false, "error": "Reminders access denied.", "needsPermission": true])
		}
		guard let body,
			let input = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
			let id = stringValue(input["id"]), !id.isEmpty
		else {
			return json(["ok": false, "error": "id is required."])
		}

		guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
			return json(["ok": false, "error": "Reminder not found. Verify the id."])
		}

		do {
			try store.remove(reminder, commit: true)
			return json(["ok": true, "data": ["id": id]])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	// MARK: - Helpers

	private static func ensureAccessAsync() async -> Bool {
		if #available(macOS 14.0, *) {
			if EKEventStore.authorizationStatus(for: .reminder) == .fullAccess {
				return true
			}
			return await withCheckedContinuation { continuation in
				store.requestFullAccessToReminders { @Sendable granted, _ in
					continuation.resume(returning: granted)
				}
			}
		} else {
			if EKEventStore.authorizationStatus(for: .reminder) == .authorized {
				return true
			}
			return await withCheckedContinuation { continuation in
				store.requestAccess(to: .reminder) { @Sendable granted, _ in
					continuation.resume(returning: granted)
				}
			}
		}
	}

	private static func fetchReminders(matching predicate: NSPredicate) async -> [EKReminder] {
		let result: ReminderFetchResult = await withCheckedContinuation { continuation in
			store.fetchReminders(matching: predicate) { reminders in
				continuation.resume(returning: ReminderFetchResult(reminders: reminders ?? []))
			}
		}
		return result.reminders
	}

	private static func resolveList(named name: String?) throws -> EKCalendar {
		let lists = store.calendars(for: .reminder)
		if let name, !name.isEmpty {
			guard let match = lists.first(where: { $0.title == name }) else {
				throw NSError(domain: "NativeAppleReminders", code: 1, userInfo: [
					NSLocalizedDescriptionKey: "Reminder list not found: \(name)",
				])
			}
			return match
		}
		if let defaultList = store.defaultCalendarForNewReminders() {
			return defaultList
		}
		if let firstList = lists.first {
			return firstList
		}
		throw NSError(domain: "NativeAppleReminders", code: 2, userInfo: [
			NSLocalizedDescriptionKey: "Reminders.app has no reminder lists configured.",
		])
	}

	private static func reminderToDict(_ reminder: EKReminder) -> [String: Any] {
		var data: [String: Any] = [
			"id": reminder.calendarItemIdentifier,
			"title": reminder.title ?? "",
			"notes": reminder.notes ?? "",
			"list": reminder.calendar.title,
			"isCompleted": reminder.isCompleted,
			"priority": reminder.priority,
			"url": reminder.url?.absoluteString ?? "",
		]
		if let dueDate = date(from: reminder.dueDateComponents) {
			data["dueDate"] = isoString(from: dueDate)
		}
		if let completionDate = reminder.completionDate {
			data["completionDate"] = isoString(from: completionDate)
		}
		return data
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

	private static func isoString(from date: Date) -> String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime]
		return formatter.string(from: date)
	}

	private static func dateComponents(from date: Date) -> DateComponents {
		Calendar.current.dateComponents(in: TimeZone.current, from: date)
	}

	private static func date(from components: DateComponents?) -> Date? {
		guard let components else { return nil }
		return Calendar.current.date(from: components)
	}

	private static func dateFromInput(_ value: Any?) -> Date? {
		guard let string = stringValue(value), !string.isEmpty else { return nil }
		if let date = parseISODate(string) { return date }
		return RemindersDateParser.rangeStart(string)
	}

	private static func dateToInput(_ value: Any?) -> Date? {
		guard let string = stringValue(value), !string.isEmpty else { return nil }
		if let date = parseISODate(string) { return date }
		return RemindersDateParser.rangeEnd(string)
	}

	private static func isValidPriority(_ priority: Int) -> Bool {
		priority == 0 || priority == 1 || priority == 5 || priority == 9
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

enum RemindersDateParser {
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
