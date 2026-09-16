import Foundation
import Testing
@testable import TobyApp

@Suite("TranscriptTimestamp")
struct TranscriptTimestampTests {
	@Test("formats compact relative times")
	func compactRelativeTimes() {
		let now = Date(timeIntervalSince1970: 1_000_000)
		#expect(TranscriptTimestamp.compactRelative(from: now.addingTimeInterval(-10), now: now) == "now")
		#expect(TranscriptTimestamp.compactRelative(from: now.addingTimeInterval(-4 * 60), now: now) == "4m ago")
		#expect(TranscriptTimestamp.compactRelative(from: now.addingTimeInterval(-3 * 3600), now: now) == "3h ago")
		#expect(TranscriptTimestamp.compactRelative(from: now.addingTimeInterval(-2 * 86_400), now: now) == "2d ago")
	}

	@Test("parses ISO timestamps with and without fractional seconds")
	func parsesISOTimestamps() {
		#expect(TranscriptTimestamp.date(fromISO: "2026-09-16T12:00:00Z") != nil)
		#expect(TranscriptTimestamp.date(fromISO: "2026-09-16T12:00:00.123Z") != nil)
		#expect(
			TranscriptTimestamp.compactRelative(
				fromISO: "not-a-date",
				now: Date()
			) == nil
		)
	}
}
