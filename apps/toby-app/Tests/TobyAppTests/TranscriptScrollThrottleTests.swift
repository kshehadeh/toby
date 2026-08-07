import Foundation
import Testing
@testable import TobyApp

@Suite("TranscriptScrollThrottle")
struct TranscriptScrollThrottleTests {
	@Test("first scroll is always immediate")
	func firstScrollIsImmediate() {
		let decision = TranscriptScrollThrottle.decision(lastScrollAt: nil, now: Date())
		#expect(decision.scrollNow)
		#expect(decision.trailingDelay == nil)
	}

	@Test("scrolls immediately after the min interval has elapsed")
	func scrollsAfterInterval() {
		let now = Date()
		let last = now.addingTimeInterval(-0.1)
		let decision = TranscriptScrollThrottle.decision(
			lastScrollAt: last,
			now: now,
			minInterval: 0.08,
		)
		#expect(decision.scrollNow)
		#expect(decision.trailingDelay == nil)
	}

	@Test("within interval schedules trailing delay instead of scrolling")
	func withinIntervalSchedulesTrailing() {
		let now = Date()
		let last = now.addingTimeInterval(-0.02)
		let decision = TranscriptScrollThrottle.decision(
			lastScrollAt: last,
			now: now,
			minInterval: 0.08,
		)
		#expect(!decision.scrollNow)
		#expect(decision.trailingDelay != nil)
		if let delay = decision.trailingDelay {
			#expect(abs(delay - 0.06) < 0.001)
		}
	}
}
