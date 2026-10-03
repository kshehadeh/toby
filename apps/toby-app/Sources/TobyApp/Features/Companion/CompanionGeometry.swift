import AppKit
import SwiftUI

enum CompanionGeometry {
	static let faceSize = NSSize(width: 112, height: 112)
	static let bubbleSize = NSSize(width: 372, height: 360)

	static func clamp(_ frame: NSRect, to screen: NSRect) -> NSRect {
		NSRect(
			x: min(max(frame.minX, screen.minX), max(screen.minX, screen.maxX - frame.width)),
			y: min(max(frame.minY, screen.minY), max(screen.minY, screen.maxY - frame.height)),
			width: frame.width, height: frame.height
		)
	}

	static func bubbleFrame(face: NSRect, screen: NSRect, size: NSSize = bubbleSize) -> NSRect {
		let gap: CGFloat = 12
		let x = face.minX - size.width - gap >= screen.minX
			? face.minX - size.width - gap : face.maxX + gap
		return clamp(NSRect(x: x, y: face.maxY - size.height,
			width: size.width, height: size.height), to: screen)
	}
}

struct CompanionBubbleShape: Shape {
	var pointsRight: Bool
	var tailY: CGFloat = 56

	func path(in rect: CGRect) -> Path {
		let left = pointsRight ? rect.minX : rect.minX + 12
		let right = pointsRight ? rect.maxX - 12 : rect.maxX
		let top = rect.minY, bottom = rect.maxY, radius: CGFloat = 20
		var path = Path()
		path.move(to: CGPoint(x: left + radius, y: top))
		path.addLine(to: CGPoint(x: right - radius, y: top))
		path.addQuadCurve(to: CGPoint(x: right, y: top + radius), control: CGPoint(x: right, y: top))
		if pointsRight {
			path.addLine(to: CGPoint(x: right, y: top + tailY - 12))
			path.addLine(to: CGPoint(x: rect.maxX, y: top + tailY))
			path.addLine(to: CGPoint(x: right, y: top + tailY + 12))
		}
		path.addLine(to: CGPoint(x: right, y: bottom - radius))
		path.addQuadCurve(to: CGPoint(x: right - radius, y: bottom), control: CGPoint(x: right, y: bottom))
		path.addLine(to: CGPoint(x: left + radius, y: bottom))
		path.addQuadCurve(to: CGPoint(x: left, y: bottom - radius), control: CGPoint(x: left, y: bottom))
		if !pointsRight {
			path.addLine(to: CGPoint(x: left, y: top + tailY + 12))
			path.addLine(to: CGPoint(x: rect.minX, y: top + tailY))
			path.addLine(to: CGPoint(x: left, y: top + tailY - 12))
		}
		path.addLine(to: CGPoint(x: left, y: top + radius))
		path.addQuadCurve(to: CGPoint(x: left + radius, y: top), control: CGPoint(x: left, y: top))
		path.closeSubpath()
		return path
	}
}
