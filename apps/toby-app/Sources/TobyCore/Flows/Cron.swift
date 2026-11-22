import Foundation

/// Five-field cron (`minute hour day-of-month month day-of-week`) with names,
/// ranges, steps, and lists. Day-of-month and day-of-week are OR'd when both
/// are restricted (classic cron / croner legacy mode). Optional 6th leading
/// seconds field is accepted and ignored when it is `0`.
public struct CronExpression: Sendable, Equatable {
	let minutes: Set<Int>
	let hours: Set<Int>
	let days: Set<Int>
	let months: Set<Int>
	let weekdays: Set<Int>
	let daysRestricted: Bool
	let weekdaysRestricted: Bool

	static let monthNames = ["JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12]
	static let dayNames = ["SUN": 0, "MON": 1, "TUE": 2, "WED": 3, "THU": 4, "FRI": 5, "SAT": 6]

	public init?(_ raw: String) {
		var fields = raw.trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: \.isWhitespace).map(String.init)
		if fields.count == 6, fields[0] == "0" { fields.removeFirst() }
		guard fields.count == 5 else { return nil }
		guard let minutes = Self.field(fields[0], 0 ... 59, [:]), let hours = Self.field(fields[1], 0 ... 23, [:]),
		      let days = Self.field(fields[2], 1 ... 31, [:]), let months = Self.field(fields[3], 1 ... 12, Self.monthNames),
		      var weekdays = Self.field(fields[4], 0 ... 7, Self.dayNames) else { return nil }
		if weekdays.remove(7) != nil { weekdays.insert(0) }
		self.minutes = minutes
		self.hours = hours
		self.days = days
		self.months = months
		self.weekdays = weekdays
		daysRestricted = fields[2] != "*" && fields[2] != "?"
		weekdaysRestricted = fields[4] != "*" && fields[4] != "?"
	}

	static func field(_ text: String, _ range: ClosedRange<Int>, _ names: [String: Int]) -> Set<Int>? {
		var out = Set<Int>()
		for part in text.uppercased().split(separator: ",", omittingEmptySubsequences: false) {
			let pieces = part.split(separator: "/", maxSplits: 1).map(String.init)
			guard !pieces.isEmpty else { return nil }
			var step = 1
			if pieces.count == 2 {
				guard let value = Int(pieces[1]), value > 0 else { return nil }
				step = value
			}
			func value(_ token: String) -> Int? { Int(token) ?? names[token] }
			var lower = range.lowerBound
			var upper = range.upperBound
			if pieces[0] == "*" || pieces[0] == "?" {
				// full range
			} else if pieces[0].contains("-") {
				let bounds = pieces[0].split(separator: "-").map(String.init)
				guard bounds.count == 2, let a = value(bounds[0]), let b = value(bounds[1]), a <= b else { return nil }
				lower = a
				upper = b
			} else {
				guard let single = value(pieces[0]) else { return nil }
				lower = single
				upper = pieces.count == 2 ? range.upperBound : single
			}
			guard range.contains(lower), range.contains(upper) else { return nil }
			for v in stride(from: lower, through: upper, by: step) { out.insert(v) }
		}
		return out.isEmpty ? nil : out
	}

	func dayMatches(_ day: Int, weekday: Int, month: Int) -> Bool {
		guard months.contains(month) else { return false }
		if daysRestricted, weekdaysRestricted { return days.contains(day) || weekdays.contains(weekday) }
		return days.contains(day) && weekdays.contains(weekday)
	}

	/// The latest occurrence strictly before `date` (croner `previousRuns`).
	public func previous(before date: Date, timezone: TimeZone = .current) -> Date? {
		previous(atOrBefore: date.addingTimeInterval(-0.001), timezone: timezone)
	}

	/// The latest occurrence at or before `date` (searches up to ~5 years back).
	func previous(atOrBefore date: Date, timezone: TimeZone = .current) -> Date? {
		var calendar = Calendar(identifier: .gregorian)
		calendar.timeZone = timezone
		var dayStart = calendar.startOfDay(for: date)
		let limitMinute = calendar.dateComponents([.hour, .minute], from: date)
		for offset in 0 ..< 1830 {
			let parts = calendar.dateComponents([.year, .month, .day, .weekday], from: dayStart)
			if dayMatches(parts.day!, weekday: parts.weekday! - 1, month: parts.month!) {
				for hour in hours.sorted(by: >) {
					if offset == 0, hour > limitMinute.hour! { continue }
					for minute in minutes.sorted(by: >) {
						if offset == 0, hour == limitMinute.hour!, minute > limitMinute.minute! { continue }
						if let candidate = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: dayStart),
						   calendar.component(.hour, from: candidate) == hour { return candidate }
					}
				}
			}
			guard let previousDay = calendar.date(byAdding: .day, value: -1, to: dayStart) else { return nil }
			dayStart = previousDay
		}
		return nil
	}

	/// The next occurrence strictly after `date`.
	public func next(after date: Date, timezone: TimeZone = .current) -> Date? {
		var calendar = Calendar(identifier: .gregorian)
		calendar.timeZone = timezone
		var dayStart = calendar.startOfDay(for: date)
		let from = calendar.dateComponents([.hour, .minute], from: date)
		for offset in 0 ..< 1830 {
			let parts = calendar.dateComponents([.month, .day, .weekday], from: dayStart)
			if dayMatches(parts.day!, weekday: parts.weekday! - 1, month: parts.month!) {
				for hour in hours.sorted() where offset > 0 || hour >= from.hour! {
					for minute in minutes.sorted() where offset > 0 || hour > from.hour! || minute > from.minute! {
						if let candidate = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: dayStart),
						   calendar.component(.hour, from: candidate) == hour { return candidate }
					}
				}
			}
			guard let nextDay = calendar.date(byAdding: .day, value: 1, to: dayStart) else { return nil }
			dayStart = nextDay
		}
		return nil
	}
}

/// Plain-language schedules → cron (port of `schedules/cron-parser.ts`).
public enum CronLanguage {
	static func hour(_ raw: Substring, _ ampm: Substring?) -> Int {
		var hour = Int(raw) ?? 0
		switch ampm?.lowercased() {
		case "pm" where hour < 12: hour += 12
		case "am" where hour == 12: hour = 0
		default: break
		}
		return hour
	}

	/// A cron expression for common phrasings, or nil (ask the model).
	public static func pattern(_ input: String) -> String? {
		let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
		if CronExpression(text) != nil { return text }
		if text.wholeMatch(of: /(?i)every\s+other\s+day(?:\s+(?:in\s+the\s+)?morning)?/) != nil { return "0 9 */2 * *" }
		if let m = text.wholeMatch(of: /(?i)every\s+other\s+day\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/) { return "\(m.2.flatMap { Int($0) } ?? 0) \(hour(m.1, m.3)) */2 * *" }
		if let m = text.wholeMatch(of: /(?i)every\s+weekday\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/) { return "\(m.2.flatMap { Int($0) } ?? 0) \(hour(m.1, m.3)) * * 1-5" }
		if let m = text.wholeMatch(of: /(?i)every\s+day\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/) { return "\(m.2.flatMap { Int($0) } ?? 0) \(hour(m.1, m.3)) * * *" }
		if let m = text.wholeMatch(of: /(?i)every\s+(\d+)\s*(min(?:ute)?s?|h(?:ou)?r?s?)/) {
			return m.2.lowercased().hasPrefix("min") ? "*/\(m.1) * * * *" : "0 */\(m.1) * * *"
		}
		switch text.lowercased() {
		case "every hour", "hourly": return "0 * * * *"
		case "every minute": return "* * * * *"
		case "daily": return "0 9 * * *"
		case "weekly": return "0 9 * * 1"
		case "monthly": return "0 9 1 * *"
		default: return nil
		}
	}

	public static let systemPrompt = """
	You convert natural language schedule descriptions into standard 5-field cron expressions (minute hour day-of-month month day-of-week).
	Rules:
	- Return ONLY the cron expression, nothing else. No explanation, no backticks, no quotes.
	- Use 24-hour time (0-23 for hours).
	- Common examples:
	  - "every weekday at 9am" → 0 9 * * 1-5
	  - "every hour on mondays only" → 0 * * * 1
	  - "every 15 minutes" → */15 * * * *
	  - "twice a day at 9am and 5pm" → 0 9,17 * * *
	  - "first of every month at noon" → 0 12 1 * *
	  - "every weekday at 8:30am" → 30 8 * * 1-5
	  - "every 6 hours" → 0 */6 * * *
	  - "every monday wednesday friday at 10am" → 0 10 * * 1,3,5
	"""
}
