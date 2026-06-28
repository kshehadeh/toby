import AppKit
import SwiftUI

enum WorkDurationFormatter {
	static func format(_ interval: TimeInterval) -> String {
		let totalSeconds = max(1, Int(interval.rounded()))
		let hours = totalSeconds / 3600
		let minutes = (totalSeconds % 3600) / 60
		let seconds = totalSeconds % 60

		if hours > 0 {
			var parts: [String] = []
			parts.append(hours == 1 ? "1 hour" : "\(hours) hours")
			if minutes > 0 {
				parts.append(minutes == 1 ? "1 minute" : "\(minutes) minutes")
			}
			if seconds > 0 {
				parts.append(seconds == 1 ? "1 second" : "\(seconds) seconds")
			}
			if parts.count > 2 {
				return parts.dropLast().joined(separator: " ") + " and " + parts.last!
			}
			return parts.joined(separator: " ")
		}

		if minutes > 0 {
			var parts: [String] = []
			parts.append(minutes == 1 ? "1 minute" : "\(minutes) minutes")
			if seconds > 0 {
				parts.append(seconds == 1 ? "1 second" : "\(seconds) seconds")
			}
			return parts.joined(separator: " and ")
		}

		return seconds == 1 ? "1s" : "\(seconds)s"
	}
}
