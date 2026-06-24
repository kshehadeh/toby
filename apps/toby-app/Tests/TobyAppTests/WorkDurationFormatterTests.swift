import Testing
import Foundation
@testable import TobyApp

@Suite("WorkDurationFormatter")
struct WorkDurationFormatterTests {

	@Test("formats seconds under a minute as Ns")
	func secondsOnly() {
		#expect(WorkDurationFormatter.format(1) == "1s")
		#expect(WorkDurationFormatter.format(30) == "30s")
		#expect(WorkDurationFormatter.format(59) == "59s")
	}

	@Test("formats exactly 1 minute as singular")
	func oneMinute() {
		#expect(WorkDurationFormatter.format(60) == "1 minute")
	}

	@Test("formats minutes with seconds using 'and'")
	func minutesAndSeconds() {
		#expect(WorkDurationFormatter.format(65) == "1 minute and 5 seconds")
		#expect(WorkDurationFormatter.format(125) == "2 minutes and 5 seconds")
	}

	@Test("formats whole minutes without seconds")
	func wholeMinutes() {
		#expect(WorkDurationFormatter.format(120) == "2 minutes")
		#expect(WorkDurationFormatter.format(180) == "3 minutes")
	}

	@Test("formats hours with minutes and seconds")
	func hoursWithMinutesAndSeconds() {
		#expect(WorkDurationFormatter.format(3723) == "1 hour 2 minutes and 3 seconds")
	}

	@Test("formats exactly 1 hour")
	func oneHour() {
		#expect(WorkDurationFormatter.format(3600) == "1 hour")
	}

	@Test("formats hours with minutes only")
	func hoursAndMinutes() {
		#expect(WorkDurationFormatter.format(3660) == "1 hour 1 minute")
	}

	@Test("formats multiple hours")
	func multipleHours() {
		#expect(WorkDurationFormatter.format(7325) == "2 hours 2 minutes and 5 seconds")
	}

	@Test("rounds fractional seconds")
	func roundsFractionalSeconds() {
		#expect(WorkDurationFormatter.format(64.7) == "1 minute and 5 seconds")
		#expect(WorkDurationFormatter.format(0.4) == "1s")
	}

	@Test("issue #50 example: 221s reads as minutes and seconds")
	func issue50Example() {
		#expect(WorkDurationFormatter.format(221) == "3 minutes and 41 seconds")
	}
}
