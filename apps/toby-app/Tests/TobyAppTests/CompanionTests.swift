import AppKit
import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("Desktop companion surfaces")
struct CompanionTests {
	@Test("Animation base portrait renders visible pixels with transparent margins")
	func portraitDrawing() throws {
		_ = try #require(CompanionPortraitArtwork.image)
		let view = CompanionPortraitView(frame: NSRect(origin: .zero, size: CompanionGeometry.faceSize))
		let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
		view.cacheDisplay(in: view.bounds, to: bitmap)
		let center = try #require(bitmap.colorAt(x: bitmap.pixelsWide / 2, y: bitmap.pixelsHigh / 2))
		#expect(center.alphaComponent > 0.9)
		let corner = try #require(bitmap.colorAt(x: 1, y: 1))
		#expect(corner.alphaComponent < 0.01)
	}

	@Test("Speech bubble changes sides and remains on the display")
	func placement() {
		let screen = NSRect(x: -1440, y: 80, width: 1440, height: 820)
		let leftFace = NSRect(x: -1430, y: 100, width: 112, height: 112)
		let leftBubble = CompanionGeometry.bubbleFrame(face: leftFace, screen: screen)
		#expect(leftBubble.minX > leftFace.maxX)
		#expect(screen.contains(leftBubble))
		let rightFace = NSRect(x: -120, y: 780, width: 112, height: 112)
		let rightBubble = CompanionGeometry.bubbleFrame(face: rightFace, screen: screen)
		#expect(rightBubble.maxX < rightFace.minX)
		#expect(screen.contains(rightBubble))
	}

	@Test("Disconnected-display position is clamped into the usable area")
	func offscreenRecovery() {
		let screen = NSRect(x: 0, y: 80, width: 1440, height: 820)
		let frame = NSRect(x: 8000, y: -500, width: 112, height: 112)
		#expect(CompanionGeometry.clamp(frame, to: screen) == NSRect(x: 1328, y: 80, width: 112, height: 112))
	}

	@Test("Face boundary includes the portrait and excludes transparent corners")
	func faceBoundary() {
		let bounds = CGRect(x: 0, y: 0, width: 128, height: 128)
		#expect(CompanionPortraitArtwork.contains(CGPoint(x: 70, y: 60), in: bounds))
		#expect(!CompanionPortraitArtwork.contains(CGPoint(x: 5, y: 5), in: bounds))
		#expect(!CompanionPortraitArtwork.contains(CGPoint(x: 120, y: 30), in: bounds))
	}

	@Test("Gaze follows direction with bounded reach and smooth settling")
	func gazeMath() {
		#expect(CompanionEyes.target(cursor: .zero, center: .zero) == .zero)
		#expect(CompanionEyes.target(cursor: CGPoint(x: -1000, y: 0), center: .zero).x == -1)
		let diagonal = CompanionEyes.target(cursor: CGPoint(x: 1000, y: -1000), center: .zero)
		#expect(diagonal.x > 0 && diagonal.y < 0)
		#expect(abs(hypot(diagonal.x, diagonal.y) - 1) < 0.0001)
		var gaze = CGPoint.zero
		for _ in 0..<30 {
			gaze = CompanionEyes.smooth(current: gaze, target: diagonal)
			#expect(hypot(gaze.x, gaze.y) <= 1.0001)
		}
		#expect(gaze == diagonal)
	}

	@Test("Pupils redraw independently and center for conversation or Reduce Motion")
	func movingEyes() throws {
		let view = CompanionPortraitView(frame: NSRect(origin: .zero, size: CompanionGeometry.faceSize))
		let still = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
		view.cacheDisplay(in: view.bounds, to: still)
		for _ in 0..<30 {
			view.updateGaze(cursor: CGPoint(x: 1000, y: -1000), engaged: false, reduceMotion: false)
		}
		#expect(view.gaze.x > 0 && view.gaze.y < 0)
		let moving = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
		view.cacheDisplay(in: view.bounds, to: moving)
		#expect(still.representation(using: .png, properties: [:]) != moving.representation(using: .png, properties: [:]))
		if let directory = ProcessInfo.processInfo.environment["TOBY_COMPANION_RENDER_DIR"] {
			try still.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: directory).appendingPathComponent("neutral.png"))
			try moving.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: directory).appendingPathComponent("looking-up-right.png"))
		}
		view.updateGaze(cursor: CGPoint(x: 1000, y: -1000), engaged: false, reduceMotion: true)
		#expect(view.gaze == .zero)
		for _ in 0..<30 { view.updateGaze(cursor: CGPoint(x: 1000, y: 0), engaged: false, reduceMotion: false) }
		for _ in 0..<30 { view.updateGaze(cursor: CGPoint(x: 1000, y: 0), engaged: true, reduceMotion: false) }
		#expect(view.gaze == .zero)
	}

	@Test("Bubble tail participates in its boundary on either side")
	func bubbleBoundary() {
		let rect = CGRect(origin: .zero, size: CompanionGeometry.bubbleSize)
		#expect(CompanionBubbleShape(pointsRight: true).path(in: rect).contains(CGPoint(x: 369, y: 56)))
		#expect(!CompanionBubbleShape(pointsRight: true).path(in: rect).contains(CGPoint(x: 369, y: 10)))
		#expect(CompanionBubbleShape(pointsRight: false).path(in: rect).contains(CGPoint(x: 3, y: 56)))
	}

	@Test("Surface exposes an accessible multiline composer and send shortcut")
	func composer() throws {
		let view = CompanionBubbleView(store: CompanionStore(), close: {}, hide: {})
		let inspected = try view.inspect()
		#expect(try inspected.find(text: "⌘Return to send").string() == "⌘Return to send")
		_ = try inspected.find(viewWithAccessibilityIdentifier: "companion-composer").textEditor()
	}
}
