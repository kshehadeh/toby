import AppKit

/// Presentation-only expression timing, using monotonic time from the caller.
struct CompanionMouthState {
	private(set) var conversationVisible = false
	private(set) var amount: CGFloat = 0
	private(set) var openness: CGFloat = 0
	private var frownUntil: TimeInterval?
	private var lastStreamingText: String?
	private var lastSpeechTime: TimeInterval?
	private var speechStartedAt: TimeInterval?

	mutating func update(conversationVisible visible: Bool, now: TimeInterval, reduceMotion: Bool,
		streamingText: String? = nil) {
		if visible != conversationVisible {
			conversationVisible = visible
			frownUntil = visible ? nil : now + 2
		}
		let target: CGFloat = visible ? 1 : ((frownUntil ?? 0) > now ? -1 : 0)
		if reduceMotion {
			amount = target
		} else {
			let next = amount + (target - amount) * 0.25
			amount = abs(next - target) < 0.005 ? target : next
		}
		guard visible, !reduceMotion, let streamingText, !streamingText.isEmpty else {
			lastStreamingText = nil
			lastSpeechTime = nil
			speechStartedAt = nil
			openness = 0
			return
		}
		if streamingText != lastStreamingText {
			if lastSpeechTime == nil || now - (lastSpeechTime ?? now) > 0.45 {
				speechStartedAt = now
			}
			lastStreamingText = streamingText
			lastSpeechTime = now
		}
		// Text delivery drives the talking motion; pause during stream/tool gaps.
		let age = now - (lastSpeechTime ?? now)
		let elapsed = now - (speechStartedAt ?? now)
		let envelope = max(0, min(1, (0.45 - age) / 0.15))
		let syllable = pow(abs(sin(elapsed * .pi * 3.4)), 1.5)
		openness = CGFloat(envelope * syllable)
	}
}

/// Native ink curves over the stationary portrait, in its original coordinate space.
enum CompanionMouth {
	static func draw(amount: CGFloat, openness: CGFloat = 0, in bounds: CGRect) {
		guard let context = NSGraphicsContext.current?.cgContext else { return }
		context.saveGState()
		context.translateBy(x: bounds.minX, y: bounds.minY)
		context.scaleBy(x: bounds.width / CompanionEyes.sourceSize.width,
			y: bounds.height / CompanionEyes.sourceSize.height)

		// Cover only the original mouth ink; the nose and face outline stay intact.
		NSColor.white.setFill()
		NSBezierPath(roundedRect: CGRect(x: 51, y: 95, width: 24, height: 12), xRadius: 2, yRadius: 2).fill()

		let curve = NSBezierPath()
		let leftY: CGFloat = 98 - amount * 1.2
		let rightY: CGFloat = 97 - amount * 1.2
		curve.move(to: CGPoint(x: 53, y: leftY))
		curve.curve(to: CGPoint(x: 73, y: rightY),
			controlPoint1: CGPoint(x: 59, y: 96.9 + amount * 2.3),
			controlPoint2: CGPoint(x: 67, y: 96.4 + amount * 2.3))
		if openness > 0 {
			curve.curve(to: CGPoint(x: 53, y: leftY),
				controlPoint1: CGPoint(x: 67, y: 96.4 + amount * 2.3 + openness * 4),
				controlPoint2: CGPoint(x: 59, y: 96.9 + amount * 2.3 + openness * 4))
			curve.close()
			CompanionEyes.ink.setFill()
			curve.fill()
		}
		curve.lineWidth = 1.9
		curve.lineCapStyle = .round
		CompanionEyes.ink.setStroke()
		curve.stroke()

		let lowerLip = NSBezierPath()
		lowerLip.move(to: CGPoint(x: 57.5, y: 103 + amount * 0.3 + openness))
		lowerLip.line(to: CGPoint(x: 64, y: 102.7 + amount * 0.3 + openness))
		lowerLip.lineWidth = 1.7
		lowerLip.lineCapStyle = .round
		lowerLip.stroke()
		context.restoreGState()
	}
}
