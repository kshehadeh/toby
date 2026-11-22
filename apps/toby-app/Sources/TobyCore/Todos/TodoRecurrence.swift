import Foundation
import TobyAI

/// A due date as stored in todo JSON: `{date, time, timezone}`.
public struct TodoDue: Sendable, Hashable {
	public var date: String
	public var time: String?
	public var timezone: String

	public init(date: String, time: String? = nil, timezone: String = "UTC") {
		self.date = date
		self.time = time
		self.timezone = timezone
	}

	init?(_ value: JSONValue?) {
		guard let value, let date = value["date"]?.stringValue else { return nil }
		self.date = date
		time = value["time"]?.stringValue
		timezone = value["timezone"]?.stringValue ?? "UTC"
	}

	var json: JSONValue {
		["date": .string(date), "time": time.map(JSONValue.string) ?? .null, "timezone": .string(timezone)]
	}

	func with(date: String? = nil, time: String?? = nil) -> TodoDue {
		TodoDue(date: date ?? self.date, time: time ?? self.time, timezone: timezone)
	}
}

/// Ports of `packages/core/src/todos/recurrence.ts`.
public enum TodoRecurrence {
	static let utc = TimeZone(identifier: "UTC")!

	static func calendar(_ timezone: TimeZone) -> Calendar {
		var calendar = Calendar(identifier: .gregorian)
		calendar.timeZone = timezone
		return calendar
	}

	/// Wall-clock `yyyy-MM-dd` / `HH:mm` of an instant in a timezone.
	public static func localDateTime(_ at: Date, timezone: String) -> (date: String, time: String) {
		let zone = TimeZone(identifier: timezone) ?? utc
		let parts = calendar(zone).dateComponents([.year, .month, .day, .hour, .minute], from: at)
		return (
			String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0),
			String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0),
		)
	}

	/// `date` + `HH:mm` read as UTC (the TS `new Date("…Z")` trick).
	static func nominal(_ date: String, _ time: String) -> Date? {
		let parts = date.split(separator: "-").compactMap { Int($0) }
		let clock = time.split(separator: ":").compactMap { Int($0) }
		guard parts.count == 3, clock.count == 2 else { return nil }
		return calendar(utc).date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: clock[0], minute: clock[1]))
	}

	/// The instant of a timed due date. Earlier offset on overlaps; forward by
	/// the gap for nonexistent times. Date-only dues return nil.
	public static func dueInstant(_ due: TodoDue) -> Date? {
		guard let time = due.time, let nominal = nominal(due.date, time) else { return nil }
		let target = "\(due.date)T\(time)"
		var offsets = Set<TimeInterval>()
		for hours in [-36.0, -12, 0, 12, 36] {
			let instant = nominal.addingTimeInterval(hours * 3600)
			let wall = localDateTime(instant, timezone: due.timezone)
			if let wallDate = Self.nominal(wall.date, wall.time) {
				offsets.insert(wallDate.timeIntervalSince(instant))
			}
		}
		let candidates = offsets.map { nominal.addingTimeInterval(-$0) }
		func wall(_ at: Date) -> String {
			let local = localDateTime(at, timezone: due.timezone)
			return "\(local.date)T\(local.time)"
		}
		if let exact = candidates.filter({ wall($0) == target }).min() { return exact }
		return candidates.filter { wall($0) > target }.min()
	}

	/// Add days/weeks/months/years to a date, clamping month ends.
	static func dateAdd(_ anchor: String, unit: String, count: Int) -> String {
		let calendar = calendar(utc)
		guard let start = nominal(anchor, "12:00") else { return anchor }
		let day = calendar.component(.day, from: start)
		var result: Date
		switch unit {
		case "day", "week":
			result = calendar.date(byAdding: .day, value: count * (unit == "week" ? 7 : 1), to: start) ?? start
		default:
			var components = calendar.dateComponents([.year, .month], from: start)
			components.day = 1
			components.hour = 12
			let firstOfMonth = calendar.date(from: components) ?? start
			let shifted = calendar.date(byAdding: .month, value: count * (unit == "year" ? 12 : 1), to: firstOfMonth) ?? firstOfMonth
			let lastDay = calendar.range(of: .day, in: .month, for: shifted)?.count ?? 28
			result = calendar.date(byAdding: .day, value: min(day, lastDay) - 1, to: shifted) ?? shifted
		}
		return localDateTime(result, timezone: "UTC").date
	}

	public static func isOverdue(_ due: TodoDue?, now: Date = Date()) -> Bool {
		guard let due else { return false }
		if let instant = dueInstant(due) { return instant < now }
		return due.date < localDateTime(now, timezone: due.timezone).date
	}

	static func daysBetween(_ a: String, _ b: String) -> Int {
		guard let first = nominal(a, "12:00"), let second = nominal(b, "12:00") else { return 0 }
		return Int((second.timeIntervalSince(first) / 86400).rounded(.down))
	}

	static func ymd(_ date: String) -> (year: Int, month: Int) {
		let parts = date.split(separator: "-").compactMap { Int($0) }
		return (parts.first ?? 0, parts.count > 1 ? parts[1] : 0)
	}

	/// Weekday (0 = Sunday) of a `yyyy-MM-dd` date.
	static func weekday(_ date: String) -> Int {
		guard let noon = nominal(date, "12:00") else { return 0 }
		return calendar(utc).component(.weekday, from: noon) - 1
	}

	/// Next instant strictly after `after` whose local time is `hour:minute`
	/// on one of `weekdays` (cron `0 M H * * D`).
	static func nextWeekdayRun(after: Date, weekdays: Set<Int>, hour: Int, minute: Int, timezone: String) -> Date? {
		var date = localDateTime(after, timezone: timezone).date
		let time = String(format: "%02d:%02d", hour, minute)
		for _ in 0 ..< 3700 {
			if weekdays.contains(weekday(date)),
			   let instant = dueInstant(TodoDue(date: date, time: time, timezone: timezone)),
			   instant > after
			{
				return instant
			}
			date = dateAdd(date, unit: "day", count: 1)
		}
		return nil
	}

	/// The next occurrence's due date, or nil when the series ends.
	public static func nextDue(anchor: TodoDue, current: TodoDue, rule: JSONValue, completedAt: String) -> TodoDue? {
		guard let completed = parseISO(completedAt),
		      let mode = rule["mode"]?.stringValue,
		      let unit = rule["unit"]?.stringValue
		else { return nil }
		let interval = max(1, rule["interval"]?.intValue ?? 1)
		let local = localDateTime(completed, timezone: anchor.timezone)
		var next: TodoDue
		let weekdays = Set((rule["weekdays"]?.arrayValue ?? []).compactMap(\.intValue))

		if mode == "completion" {
			next = anchor.with(date: dateAdd(local.date, unit: unit, count: interval), time: .some(anchor.time != nil ? local.time : nil))
		} else if !weekdays.isEmpty {
			let hour = anchor.time.flatMap { Int($0.prefix(2)) } ?? 12
			let minute = anchor.time.flatMap { Int($0.suffix(2)) } ?? 0
			let currentEnd = dueInstant(current.with(time: .some(current.time ?? "23:59")))
			var after = max(completed, currentEnd ?? .distantPast)
			let anchorWeekStart = dateAdd(anchor.date, unit: "day", count: -weekday(anchor.date))
			var found: Date?
			while let candidate = nextWeekdayRun(after: after, weekdays: weekdays, hour: hour, minute: minute, timezone: anchor.timezone) {
				let wall = localDateTime(candidate, timezone: anchor.timezone)
				let days = daysBetween(anchorWeekStart, wall.date)
				if (days / 7) % interval == 0 {
					found = candidate
					break
				}
				after = candidate
			}
			guard let found else { return nil }
			next = anchor.with(date: localDateTime(found, timezone: anchor.timezone).date)
		} else {
			let threshold = current.date > local.date ? current.date : local.date
			let a = ymd(anchor.date)
			let b = ymd(threshold)
			let distance: Int = switch unit {
			case "year": b.year - a.year
			case "month": (b.year - a.year) * 12 + b.month - a.month
			default: Int((Double(daysBetween(anchor.date, threshold)) / (unit == "week" ? 7 : 1)).rounded(.down))
			}
			var step = max(1, Int((Double(distance) / Double(interval)).rounded(.down)))
			next = anchor.with(date: dateAdd(anchor.date, unit: unit, count: step * interval))
			func tooEarly(_ candidate: TodoDue) -> Bool {
				if candidate.date <= current.date { return true }
				if candidate.time != nil {
					return (dueInstant(candidate) ?? .distantPast) <= completed
				}
				return candidate.date <= local.date
			}
			while tooEarly(next) {
				step += 1
				next = anchor.with(date: dateAdd(anchor.date, unit: unit, count: step * interval))
			}
		}
		if let end = rule["endDate"]?.stringValue, next.date > end { return nil }
		return next
	}

	// MARK: ISO-8601

	static func parseISO(_ text: String) -> Date? {
		let fractional = ISO8601DateFormatter()
		fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		if let date = fractional.date(from: text) { return date }
		return ISO8601DateFormatter().date(from: text)
	}

	/// JS `Date.toISOString()` format: `yyyy-MM-ddTHH:mm:ss.SSSZ`.
	public static func isoString(_ date: Date) -> String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return formatter.string(from: date)
	}
}
