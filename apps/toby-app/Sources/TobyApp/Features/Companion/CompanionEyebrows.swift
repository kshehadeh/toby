import AppKit

/// A held, asymmetric processing expression rather than a repeating bounce.
struct CompanionEyebrowState {
	private(set) var amount: CGFloat = 0

	mutating func update(processing: Bool, reduceMotion: Bool) {
		let target: CGFloat = processing ? 1 : 0
		let next = reduceMotion ? target : amount + (target - amount) * 0.2
		amount = abs(next - target) < 0.005 ? target : next
	}
}

enum CompanionEyebrows {
	static func draw(leftRaise: CGFloat = 0, rightRaise: CGFloat, in bounds: CGRect) {
		guard let context = NSGraphicsContext.current?.cgContext else { return }
		context.saveGState()
		context.translateBy(x: bounds.minX, y: bounds.minY)
		context.scaleBy(x: bounds.width / CompanionEyes.sourceSize.width,
			y: bounds.height / CompanionEyes.sourceSize.height)

		for (right, amount) in [(false, leftRaise), (true, rightRaise)] {
			// Keep the resting left brow in the source artwork, close to the outline.
			guard right || amount > 0 else { continue }
			// Erase just the stationary brow stroke, preserving the head outline.
			let original = path(right: right, raise: 0)
			original.lineWidth = 4.8
			original.lineCapStyle = .round
			NSColor.white.setStroke()
			original.stroke()

			let brow = path(right: right, raise: min(max(amount, 0), 1))
			brow.lineWidth = 2.4
			brow.lineCapStyle = .round
			CompanionEyes.ink.setStroke()
			brow.stroke()
		}
		context.restoreGState()
	}

	private static func path(right: Bool, raise: CGFloat) -> NSBezierPath {
		let path = NSBezierPath()
		let lift = raise * 4
		if right {
			path.move(to: CGPoint(x: 61, y: 63 - lift))
			path.curve(to: CGPoint(x: 75, y: 62.6 - lift * 0.7),
				controlPoint1: CGPoint(x: 65, y: 60.5 - lift),
				controlPoint2: CGPoint(x: 70, y: 60.3 - lift))
		} else {
			path.move(to: CGPoint(x: 42.3, y: 66.9 - lift))
			path.curve(to: CGPoint(x: 51, y: 65.2 - lift),
				controlPoint1: CGPoint(x: 44, y: 65 - lift),
				controlPoint2: CGPoint(x: 48, y: 64.3 - lift))
		}
		return path
	}
}
