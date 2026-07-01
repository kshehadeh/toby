import Foundation

enum CronHelpers {
	static func isValidExpression(_ expression: String) -> Bool {
		let parts = expression.split(separator: " ").map(String.init)
		guard parts.count == 5 else { return false }
		return parseField(parts[0], min: 0, max: 59) != nil
			&& parseField(parts[1], min: 0, max: 23) != nil
			&& parseField(parts[2], min: 1, max: 31) != nil
			&& parseField(parts[3], min: 1, max: 12) != nil
			&& parseField(parts[4], min: 0, max: 7) != nil
	}

	/// Return a human-readable description for common cron expressions, or the raw expression.
	static func describe(_ expression: String) -> String {
		let parts = expression.split(separator: " ").map(String.init)
		guard parts.count == 5 else { return expression }
		let minute = parts[0]
		let hour = parts[1]
		let dayOfMonth = parts[2]
		let month = parts[3]
		let dayOfWeek = parts[4]

		if minute == "0" && hour == "*" && dayOfMonth == "*" && month == "*" && dayOfWeek == "*" {
			return "Every hour"
		}
		if minute == "0" && hour.hasPrefix("*/"), let step = Int(hour.dropFirst(2)) {
			return "Every \(step) hours"
		}
		if minute.hasPrefix("*/"), let step = Int(minute.dropFirst(2)), hour == "*" {
			return "Every \(step) minutes"
		}
		if let h = Int(hour), minute == "0", dayOfMonth == "*", month == "*" {
			if dayOfWeek == "*" {
				return "Every day at \(formatHour(h))"
			}
			if dayOfWeek == "1-5" {
				return "Weekdays at \(formatHour(h))"
			}
			if dayOfWeek == "1" {
				return "Mondays at \(formatHour(h))"
			}
			if dayOfWeek == "2" {
				return "Tuesdays at \(formatHour(h))"
			}
			if dayOfWeek == "3" {
				return "Wednesdays at \(formatHour(h))"
			}
			if dayOfWeek == "4" {
				return "Thursdays at \(formatHour(h))"
			}
			if dayOfWeek == "5" {
				return "Fridays at \(formatHour(h))"
			}
			if dayOfWeek == "6" {
				return "Saturdays at \(formatHour(h))"
			}
			if dayOfWeek == "0" || dayOfWeek == "7" {
				return "Sundays at \(formatHour(h))"
			}
		}
		return expression
	}

	/// Compute the next run date on or after `from` for a cron expression.
	static func nextRunDate(for expression: String, from: Date = Date()) -> Date? {
		let parts = expression.split(separator: " ").map(String.init)
		guard parts.count == 5 else { return nil }
		guard
			let minuteSet = parseField(parts[0], min: 0, max: 59),
			let hourSet = parseField(parts[1], min: 0, max: 23),
			let dayOfMonthSet = parseField(parts[2], min: 1, max: 31),
			let monthSet = parseField(parts[3], min: 1, max: 12),
			let dayOfWeekSet = parseField(parts[4], min: 0, max: 7)
		else {
			return nil
		}

		var calendar = Calendar.current
		calendar.timeZone = TimeZone.current
		var candidate = calendar.date(byAdding: .minute, value: 1, to: from) ?? from
		// Cap the search to avoid infinite loops for malformed expressions.
		guard let maxDate = calendar.date(byAdding: .year, value: 4, to: from) else { return nil }

		while candidate <= maxDate {
			let components = calendar.dateComponents([.minute, .hour, .day, .month, .weekday], from: candidate)
			guard
				let min = components.minute,
				let hr = components.hour,
				let day = components.day,
				let mon = components.month,
				let weekday = components.weekday
			else {
				candidate = calendar.date(byAdding: .minute, value: 1, to: candidate) ?? Date.distantFuture
				continue
			}
			// weekday is 1=Sunday ... 7=Saturday. Convert to 0=Sunday ... 6=Saturday.
			let cronWeekday = weekday - 1
			let matchesWeekday = dayOfWeekSet.contains(cronWeekday) || (cronWeekday == 0 && dayOfWeekSet.contains(7))
			if minuteSet.contains(min) && hourSet.contains(hr) && dayOfMonthSet.contains(day) && monthSet.contains(mon) && matchesWeekday {
				return candidate
			}
			candidate = calendar.date(byAdding: .minute, value: 1, to: candidate) ?? Date.distantFuture
		}
		return nil
	}

	static func relativeTime(until date: Date) -> String {
		let seconds = date.timeIntervalSince(Date())
		if seconds < 60 {
			return "in <1m"
		}
		let minutes = Int(seconds / 60)
		if minutes < 60 {
			return "in \(minutes)m"
		}
		let hours = minutes / 60
		let remainingMinutes = minutes % 60
		if hours < 24 {
			return remainingMinutes > 0 ? "in \(hours)h \(remainingMinutes)m" : "in \(hours)h"
		}
		let days = hours / 24
		let remainingHours = hours % 24
		return remainingHours > 0 ? "in \(days)d \(remainingHours)h" : "in \(days)d"
	}

	// MARK: - Private

	private static func formatHour(_ hour: Int) -> String {
		let h = hour % 12
		let displayHour = h == 0 ? 12 : h
		let suffix = hour < 12 ? "AM" : "PM"
		return "\(displayHour):00 \(suffix)"
	}

	private static func parseField(_ field: String, min: Int, max: Int) -> Set<Int>? {
		var values = Set<Int>()
		let parts = field.split(separator: ",")
		for part in parts {
			let trimmed = String(part)
			if trimmed == "*" {
				return Set(min...max)
			}
			if trimmed.hasPrefix("*/") {
				guard let step = Int(trimmed.dropFirst(2)), step > 0 else { return nil }
				var v = min
				while v <= max {
					values.insert(v)
					v += step
				}
				continue
			}
			if trimmed.contains("-") {
				let rangeParts = trimmed.split(separator: "-")
				guard rangeParts.count == 2,
					let lower = Int(rangeParts[0]),
					let upper = Int(rangeParts[1]),
					lower >= min,
					upper <= max,
					lower <= upper
				else { return nil }
				values.formUnion(lower...upper)
				continue
			}
			guard let value = Int(trimmed), value >= min, value <= max else { return nil }
			values.insert(value)
		}
		return values
	}
}
