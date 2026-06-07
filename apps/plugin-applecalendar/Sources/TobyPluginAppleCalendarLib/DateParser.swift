import Foundation

public enum DateParser {
	private static let monthNames = [
		"January", "February", "March", "April", "May", "June",
		"July", "August", "September", "October", "November", "December",
	]

	/// Parse user-supplied date strings (ISO 8601, natural language, slash dates).
	public static func parseUserDate(_ input: String) throws -> Date {
		let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else {
			throw CalendarFailure(message: "Date value is empty.")
		}

		let iso = ISO8601DateFormatter()
		iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		if let date = iso.date(from: trimmed) { return date }
		iso.formatOptions = [.withInternetDateTime]
		if let date = iso.date(from: trimmed) { return date }

		let isoDateOnly = trimmed.range(
			of: #"^\d{4}-\d{2}-\d{2}$"#,
			options: .regularExpression
		)
		if isoDateOnly != nil {
			let parts = trimmed.split(separator: "-")
			guard parts.count == 3,
				let year = Int(parts[0]),
				let month = Int(parts[1]),
				let day = Int(parts[2])
			else {
				throw CalendarFailure(message: "Invalid date: \(input)")
			}
			var components = DateComponents()
			components.year = year
			components.month = month
			components.day = day
			components.hour = 0
			components.minute = 0
			components.second = 0
			guard let date = Calendar.current.date(from: components) else {
				throw CalendarFailure(message: "Invalid date: \(input)")
			}
			return date
		}

		let slashDateOnly = trimmed.range(
			of: #"^\d{1,2}/\d{1,2}/\d{4}$"#,
			options: .regularExpression
		)
		if slashDateOnly != nil {
			let parts = trimmed.split(separator: "/")
			guard parts.count == 3,
				let month = Int(parts[0]),
				let day = Int(parts[1]),
				let year = Int(parts[2])
			else {
				throw CalendarFailure(message: "Invalid date: \(input)")
			}
			var components = DateComponents()
			components.year = year
			components.month = month
			components.day = day
			components.hour = 0
			components.minute = 0
			components.second = 0
			guard let date = Calendar.current.date(from: components) else {
				throw CalendarFailure(message: "Invalid date: \(input)")
			}
			return date
		}

		let natural = DateFormatter()
		natural.locale = Locale(identifier: "en_US_POSIX")
		natural.dateFormat = "MMMM d, yyyy h:mm:ss a"
		if let date = natural.date(from: trimmed) { return date }
		natural.dateFormat = "MMMM d, yyyy"
		if let date = natural.date(from: trimmed) { return date }

		let fallback = DateFormatter()
		fallback.dateStyle = .long
		fallback.timeStyle = .short
		if let date = fallback.date(from: trimmed) { return date }

		throw CalendarFailure(message: "Invalid date: \(input)")
	}

	public static func searchRangeStart(_ input: String?) -> Date? {
		guard let input, !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
			return nil
		}
		return try? parseUserDate(input)
	}

	public static func searchRangeEnd(_ input: String?) -> Date? {
		guard let input, !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
			return nil
		}
		guard let date = try? parseUserDate(input) else { return nil }
		if isDateOnlyInput(input) {
			var components = Calendar.current.dateComponents([.year, .month, .day], from: date)
			components.day = (components.day ?? 0) + 1
			components.hour = 0
			components.minute = 0
			components.second = 0
			return Calendar.current.date(from: components) ?? date.addingTimeInterval(86_400)
		}
		return date
	}

	public static func isDateOnlyInput(_ input: String) -> Bool {
		let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
			return true
		}
		if trimmed.range(of: #"^\d{1,2}/\d{1,2}/\d{4}$"#, options: .regularExpression) != nil {
			return true
		}
		if trimmed.range(of: #"^[a-zA-Z]+ \d{1,2},? \d{4}$"#, options: .regularExpression) != nil {
			return true
		}
		return false
	}

	/// Port of normalizeToAppleScriptDate for AppleScript fallback paths.
	public static func normalizeToAppleScriptDate(_ input: String) -> String {
		if input.range(of: #"[a-zA-Z]{2,}"#, options: .regularExpression) != nil {
			return input
		}

		let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
		if trimmed.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
			let parts = trimmed.split(separator: "-")
			guard parts.count == 3,
				let year = Int(parts[0]),
				let monthIndex = Int(parts[1]),
				let day = Int(parts[2])
			else { return input }
			let month = monthNames[min(max(monthIndex - 1, 0), 11)]
			return "\(month) \(day), \(year)"
		}

		if trimmed.range(of: #"^\d{1,2}/\d{1,2}/\d{4}$"#, options: .regularExpression) != nil {
			let parts = trimmed.split(separator: "/")
			guard parts.count == 3,
				let monthIndex = Int(parts[0]),
				let day = Int(parts[1]),
				let year = Int(parts[2])
			else { return input }
			let month = monthNames[min(max(monthIndex - 1, 0), 11)]
			return "\(month) \(day), \(year)"
		}

		if let date = try? parseUserDate(input) {
			let month = monthNames[Calendar.current.component(.month, from: date) - 1]
			let day = Calendar.current.component(.day, from: date)
			let year = Calendar.current.component(.year, from: date)
			let hours = Calendar.current.component(.hour, from: date)
			let minutes = Calendar.current.component(.minute, from: date)
			let seconds = Calendar.current.component(.second, from: date)
			let ampm = hours >= 12 ? "PM" : "AM"
			let h12 = hours % 12 == 0 ? 12 : hours % 12
			return String(
				format: "%@ %d, %d %d:%02d:%02d %@",
				month, day, year, h12, minutes, seconds, ampm
			)
		}

		return input
	}
}
