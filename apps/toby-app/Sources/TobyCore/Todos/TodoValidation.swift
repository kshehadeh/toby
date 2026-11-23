import Foundation
import GRDB
import TobyAI

/// A todo-domain error. `code` and `status` match the daemon's API so callers
/// and the UI keep the same handling.
public struct TodoError: Error, Sendable, Equatable, LocalizedError {
	public let code: String
	public let message: String
	public let status: Int

	public init(_ code: String, _ message: String, status: Int = 400) {
		self.code = code
		self.message = message
		self.status = status
	}

	public var errorDescription: String? { message }

	static func invalid(_ message: String) -> TodoError {
		TodoError("invalid_input", message)
	}
}

/// Caller context for a mutation (mirrors the TS `MutationContext`).
public struct TodoMutationContext: Sendable {
	/// Participating local services commit their side of a mutation in the same transaction.
	var onCommit: (@Sendable (Database, JSONValue) throws -> Void)?
	public var source: String?
	public var idempotencyKey: String?
	/// Deterministic id used by automatic follow-ups; not accepted from tools.
	public var internalTodoId: String?
	public var expectedRevision: String?
	public var dryRun: Bool
	/// ISO-8601 timestamp override (tests).
	public var now: String?

	public init(
		source: String? = nil,
		idempotencyKey: String? = nil,
		internalTodoId: String? = nil,
		expectedRevision: String? = nil,
		dryRun: Bool = false,
		now: String? = nil,
	) {
		self.source = source
		self.idempotencyKey = idempotencyKey
		self.internalTodoId = internalTodoId
		self.expectedRevision = expectedRevision
		self.dryRun = dryRun
		self.now = now
	}
}

/// Ports of the zod schemas in `packages/core/src/todos/types.ts`. Each
/// `parse` validates and applies defaults, returning normalized JSON.
enum TodoSchema {
	static let todoFieldKeys = ["title", "description", "priority", "listId", "projectId", "projectLabel", "recurrence"]
	static let priorities: Set<String> = ["none", "low", "medium", "high"]

	// MARK: Scalars

	static func isID(_ value: String) -> Bool {
		guard (1 ... 200).contains(value.count) else { return false }
		return value.unicodeScalars.allSatisfy { scalar in
			CharacterSet.alphanumerics.contains(scalar) && scalar.isASCII || ":_-".unicodeScalars.contains(scalar)
		}
	}

	static func id(_ value: JSONValue?, _ field: String) throws -> String {
		guard let text = value?.stringValue, isID(text) else { throw TodoError.invalid("Invalid \(field).") }
		return text
	}

	static func isDate(_ value: String) -> Bool {
		guard value.count == 10, value.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil else { return false }
		let parts = value.split(separator: "-").compactMap { Int($0) }
		var calendar = Calendar(identifier: .gregorian)
		calendar.timeZone = TimeZone(identifier: "UTC")!
		guard let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)) else { return false }
		let back = calendar.dateComponents([.year, .month, .day], from: date)
		return back.year == parts[0] && back.month == parts[1] && back.day == parts[2]
	}

	static func isTime(_ value: String) -> Bool {
		value.wholeMatch(of: /([01]\d|2[0-3]):[0-5]\d/) != nil
	}

	/// zod `.datetime()`: UTC ISO-8601 with optional fractional seconds.
	static func isDateTime(_ value: String) -> Bool {
		value.wholeMatch(of: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/) != nil
	}

	static func isTimezone(_ value: String) -> Bool {
		value.count <= 100 && TimeZone(identifier: value) != nil
	}

	// MARK: Objects

	static func object(_ value: JSONValue?, _ what: String, allowed: Set<String>) throws -> [String: JSONValue] {
		guard let object = value?.objectValue else { throw TodoError.invalid("\(what) must be an object.") }
		if let extra = object.keys.first(where: { !allowed.contains($0) }) {
			throw TodoError.invalid("Unrecognized key in \(what): \(extra)")
		}
		return object
	}

	static func due(_ value: JSONValue) throws -> JSONValue {
		let object = try Self.object(value, "due", allowed: ["date", "time", "timezone"])
		guard let date = object["date"]?.stringValue, isDate(date) else { throw TodoError.invalid("Invalid calendar date") }
		var time: JSONValue = .null
		if let raw = object["time"], !raw.isNull {
			guard let text = raw.stringValue, isTime(text) else { throw TodoError.invalid("Invalid due time.") }
			time = .string(text)
		}
		let timezone = object["timezone"]?.stringValue ?? "UTC"
		guard isTimezone(timezone) else { throw TodoError.invalid("Invalid timezone") }
		return ["date": .string(date), "time": time, "timezone": .string(timezone)]
	}

	static func nullableDue(_ value: JSONValue?) throws -> JSONValue {
		guard let value, !value.isNull else { return .null }
		return try due(value)
	}

	static func recurrence(_ value: JSONValue) throws -> JSONValue {
		let object = try Self.object(value, "recurrence", allowed: ["mode", "unit", "interval", "weekdays", "endDate"])
		guard let mode = object["mode"]?.stringValue, ["calendar", "completion"].contains(mode) else {
			throw TodoError.invalid("Invalid recurrence mode.")
		}
		guard let unit = object["unit"]?.stringValue, ["day", "week", "month", "year"].contains(unit) else {
			throw TodoError.invalid("Invalid recurrence unit.")
		}
		var result: [String: JSONValue] = ["mode": .string(mode), "unit": .string(unit)]
		let interval = object["interval"].map { $0.doubleValue } ?? 1
		guard let interval, interval == interval.rounded(), (1 ... 1000).contains(interval) else {
			throw TodoError.invalid("Invalid recurrence interval.")
		}
		result["interval"] = .number(interval)
		if let weekdays = object["weekdays"] {
			guard let items = weekdays.arrayValue, items.count <= 7,
			      items.allSatisfy({ ($0.doubleValue).map { $0 == $0.rounded() && (0 ... 6).contains($0) } ?? false })
			else { throw TodoError.invalid("Invalid recurrence weekdays.") }
			if !items.isEmpty, !(mode == "calendar" && unit == "week") {
				throw TodoError.invalid("Weekdays require weekly calendar recurrence")
			}
			result["weekdays"] = .array(items)
		}
		if let endDate = object["endDate"] {
			if endDate.isNull {
				result["endDate"] = .null
			} else {
				guard let text = endDate.stringValue, isDate(text) else { throw TodoError.invalid("Invalid recurrence end date.") }
				result["endDate"] = .string(text)
			}
		}
		return .object(result)
	}

	/// `todoFieldsSchema.parse` (strict, with defaults).
	static func fields(_ object: [String: JSONValue]) throws -> [String: JSONValue] {
		if let extra = object.keys.first(where: { !todoFieldKeys.contains($0) }) {
			throw TodoError.invalid("Unrecognized key: \(extra)")
		}
		return try fields(partial: object, applyDefaults: true)
	}

	/// Validate the todo fields present in `object`; with `applyDefaults`,
	/// fill the rest like zod does.
	static func fields(partial object: [String: JSONValue], applyDefaults: Bool) throws -> [String: JSONValue] {
		var result: [String: JSONValue] = [:]
		func present(_ key: String) -> JSONValue? {
			guard let value = object[key] else { return nil }
			return value
		}
		if let raw = present("title") {
			guard let text = raw.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), (1 ... 1000).contains(text.count) else {
				throw TodoError.invalid("A title is required (up to 1000 characters).")
			}
			result["title"] = .string(text)
		} else if applyDefaults {
			throw TodoError.invalid("A title is required.")
		}
		if let raw = present("description") {
			guard let text = raw.stringValue, text.count <= 100_000 else { throw TodoError.invalid("Invalid description.") }
			result["description"] = .string(text)
		} else if applyDefaults {
			result["description"] = ""
		}
		if let raw = present("priority") {
			guard let text = raw.stringValue, priorities.contains(text) else { throw TodoError.invalid("Invalid priority.") }
			result["priority"] = .string(text)
		} else if applyDefaults {
			result["priority"] = "none"
		}
		if let raw = present("listId") {
			result["listId"] = .string(try id(raw, "listId"))
		} else if applyDefaults {
			result["listId"] = "inbox"
		}
		if let raw = present("projectId") {
			result["projectId"] = raw.isNull ? .null : .string(try id(raw, "projectId"))
		} else if applyDefaults {
			result["projectId"] = .null
		}
		if let raw = present("projectLabel") {
			if raw.isNull {
				result["projectLabel"] = .null
			} else {
				guard let text = raw.stringValue, text.count <= 1000 else { throw TodoError.invalid("Invalid projectLabel.") }
				result["projectLabel"] = .string(text)
			}
		} else if applyDefaults {
			result["projectLabel"] = .null
		}
		if let raw = present("recurrence") {
			result["recurrence"] = raw.isNull ? .null : try recurrence(raw)
		} else if applyDefaults {
			result["recurrence"] = .null
		}
		return result
	}

	static func checklistItem(_ value: JSONValue) throws -> JSONValue {
		let object = try Self.object(value, "checklist item", allowed: ["id", "text", "order", "checked"])
		let itemID = try id(object["id"], "checklist id")
		guard let text = object["text"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), (1 ... 2000).contains(text.count) else {
			throw TodoError.invalid("Checklist text is required.")
		}
		guard let order = object["order"]?.doubleValue, order.isFinite else { throw TodoError.invalid("Checklist order must be a number.") }
		var checked = false
		if let raw = object["checked"] {
			guard let flag = raw.boolValue else { throw TodoError.invalid("Checklist checked must be a boolean.") }
			checked = flag
		}
		return ["id": .string(itemID), "text": .string(text), "order": .number(order), "checked": .bool(checked)]
	}

	static func reminder(_ value: JSONValue) throws -> JSONValue {
		let object = try Self.object(value, "reminder", allowed: ["id", "at", "offsetMinutes", "snoozedUntil"])
		let reminderID = try id(object["id"], "reminder id")
		func datetime(_ key: String) throws -> JSONValue {
			guard let raw = object[key], !raw.isNull else { return .null }
			guard let text = raw.stringValue, isDateTime(text) else { throw TodoError.invalid("Invalid reminder \(key).") }
			return .string(text)
		}
		let at = try datetime("at")
		let snoozed = try datetime("snoozedUntil")
		var offset: JSONValue = .null
		if let raw = object["offsetMinutes"], !raw.isNull {
			guard let minutes = raw.doubleValue, minutes == minutes.rounded(), (0 ... 525_600).contains(minutes) else {
				throw TodoError.invalid("Invalid reminder offset.")
			}
			offset = .number(minutes)
		}
		guard at.isNull != offset.isNull else {
			throw TodoError.invalid("Specify an absolute reminder time or a due-time offset")
		}
		return ["id": .string(reminderID), "at": at, "offsetMinutes": offset, "snoozedUntil": snoozed]
	}

	static func bool(_ value: JSONValue?, default fallback: Bool, _ field: String) throws -> Bool {
		guard let value, !value.isNull else { return fallback }
		guard let flag = value.boolValue else { throw TodoError.invalid("\(field) must be a boolean.") }
		return flag
	}

	static func int(_ value: JSONValue?, _ field: String, min: Int = 0) throws -> Int? {
		guard let value, !value.isNull else { return nil }
		guard let number = value.doubleValue, number == number.rounded(), number >= Double(min) else {
			throw TodoError.invalid("\(field) must be a whole number.")
		}
		return Int(number)
	}
}
