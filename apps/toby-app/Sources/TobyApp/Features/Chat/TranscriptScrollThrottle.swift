import Foundation

/// Decides when streaming transcript growth should scroll to the bottom.
/// Leading-edge throttle with a trailing catch-up so the view stays near the
/// bottom during token streams without scrolling on every delta.
enum TranscriptScrollThrottle {
	/// Minimum interval between streaming-driven scrolls (~12.5 fps).
	static let streamingMinInterval: TimeInterval = 0.08

	struct Decision: Equatable {
		/// Scroll immediately on this event.
		var scrollNow: Bool
		/// If set, schedule another scroll after this many seconds (trailing edge).
		var trailingDelay: TimeInterval?
	}

	static func decision(
		lastScrollAt: Date?,
		now: Date = Date(),
		minInterval: TimeInterval = streamingMinInterval,
	) -> Decision {
		guard let lastScrollAt else {
			return Decision(scrollNow: true, trailingDelay: nil)
		}
		let elapsed = now.timeIntervalSince(lastScrollAt)
		if elapsed >= minInterval {
			return Decision(scrollNow: true, trailingDelay: nil)
		}
		return Decision(scrollNow: false, trailingDelay: minInterval - elapsed)
	}
}
