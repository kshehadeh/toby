import AppKit

/// Eye whites and pupils are independent native layers. Only the pupils
/// move; the portrait and conversation don't participate in these redraws.
enum CompanionEyes {
	static let sourceSize = CGSize(width: 155, height: 156)
	static let eyeRects = [
		CGRect(x: 41, y: 68, width: 9, height: 5),
		CGRect(x: 61, y: 65, width: 11, height: 5.5),
	]
	static let ink = NSColor(calibratedRed: 0.07, green: 0.12, blue: 0.20, alpha: 1)

	/// Saturate at the eye's reach while preserving the cursor's direction.
	static func target(cursor: CGPoint, center: CGPoint) -> CGPoint {
		guard cursor.x.isFinite, cursor.y.isFinite else { return .zero }
		let dx = (cursor.x - center.x) / 100
		let dy = (cursor.y - center.y) / 100
		let length = max(1, hypot(dx, dy))
		return CGPoint(x: dx / length, y: dy / length)
	}

	static func smooth(current: CGPoint, target: CGPoint) -> CGPoint {
		let next = CGPoint(x: current.x + (target.x - current.x) * 0.35,
			y: current.y + (target.y - current.y) * 0.35)
		return hypot(next.x - target.x, next.y - target.y) < 0.005 ? target : next
	}

	static func draw(gaze: CGPoint, in bounds: CGRect) {
		guard let context = NSGraphicsContext.current?.cgContext else { return }
		context.saveGState()
		context.translateBy(x: bounds.minX, y: bounds.minY)
		context.scaleBy(x: bounds.width / sourceSize.width, y: bounds.height / sourceSize.height)
		for rect in eyeRects {
			let eye = NSBezierPath()
			eye.move(to: NSPoint(x: rect.minX, y: rect.midY))
			eye.curve(to: NSPoint(x: rect.maxX, y: rect.midY),
				controlPoint1: NSPoint(x: rect.midX - 2, y: rect.minY - 1),
				controlPoint2: NSPoint(x: rect.midX + 2, y: rect.minY - 1))
			let upperLid = NSBezierPath()
			upperLid.append(eye)
			// Keep the closed eye shape for pupil clipping, but draw only its upper edge.
			eye.curve(to: NSPoint(x: rect.minX, y: rect.midY),
				controlPoint1: NSPoint(x: rect.midX + 2, y: rect.maxY + 1),
				controlPoint2: NSPoint(x: rect.midX - 2, y: rect.maxY + 1))
			eye.close()
			NSColor.white.setFill()
			eye.fill()
			context.saveGState()
			eye.addClip()
			let pupil = CGRect(x: rect.midX + gaze.x * 2 - 2,
				y: rect.midY + gaze.y * 0.9 - 2, width: 4, height: 4)
			ink.setFill()
			NSBezierPath(ovalIn: pupil).fill()
			context.restoreGState()
			ink.setStroke()
			upperLid.lineWidth = 0.8
			upperLid.stroke()
		}
		context.restoreGState()
	}
}
