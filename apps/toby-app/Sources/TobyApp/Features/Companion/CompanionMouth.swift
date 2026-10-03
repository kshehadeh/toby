import AppKit

/// Presentation-only expression timing, using monotonic time from the caller.
struct CompanionMouthState {
	private(set) var conversationVisible = false
	private(set) var amount: CGFloat = 0
	private var frownUntil: TimeInterval?

	mutating func update(conversationVisible visible: Bool, now: TimeInterval, reduceMotion: Bool) {
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
	}
}

/// Native ink curves over the stationary portrait, in its original coordinate space.
enum CompanionMouth {
	static func draw(amount: CGFloat, in bounds: CGRect) {
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
		curve.lineWidth = 1.9
		curve.lineCapStyle = .round
		CompanionEyes.ink.setStroke()
		curve.stroke()

		let lowerLip = NSBezierPath()
		lowerLip.move(to: CGPoint(x: 57.5, y: 103 + amount * 0.3))
		lowerLip.line(to: CGPoint(x: 64, y: 102.7 + amount * 0.3))
		lowerLip.lineWidth = 1.7
		lowerLip.lineCapStyle = .round
		lowerLip.stroke()
		context.restoreGState()
	}
}
