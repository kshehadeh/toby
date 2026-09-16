import Foundation

enum TranscriptTimestamp: Sendable {
	static func nowISO() -> String {
		Date.now.formatted(.iso8601.year().month().day().dateSeparator(.dash)
			.dateTimeSeparator(.standard)
			.time(includingFractionalSeconds: true)
			.timeSeparator(.colon)
			.timeZone(separator: .omitted))
	}

	static func date(fromISO value: String) -> Date? {
		if let date = try? Date(value, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) {
			return date
		}
		return try? Date(value, strategy: .iso8601)
	}

	static func compactRelative(fromISO value: String, now: Date = Date()) -> String? {
		guard let date = date(fromISO: value) else { return nil }
		return compactRelative(from: date, now: now)
	}

	static func compactRelative(from date: Date, now: Date = Date()) -> String {
		let seconds = max(0, now.timeIntervalSince(date))
		if seconds < 45 { return "now" }
		if seconds < 3600 {
			let minutes = max(1, Int((seconds / 60).rounded()))
			return "\(minutes)m ago"
		}
		if seconds < 86_400 {
			let hours = max(1, Int((seconds / 3600).rounded()))
			return "\(hours)h ago"
		}
		let days = max(1, Int((seconds / 86_400).rounded()))
		if days < 7 { return "\(days)d ago" }
		return date.formatted(date: .abbreviated, time: .omitted)
	}
}
