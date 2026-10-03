import AppKit

/// A stationary cutout plus independent eye and mouth layers. Dragging doesn't take focus.
final class CompanionPortraitView: NSView {
	var open: (() -> Void)?
	var moved: (() -> Void)?
	var hide: (() -> Void)?
	private var dragStart: NSPoint?
	private var originalOrigin: NSPoint?
	private var didDrag = false
	var isDragging: Bool { dragStart != nil }
	private(set) var gaze: CGPoint = .zero
	private(set) var mouth = CompanionMouthState()
	override var isFlipped: Bool { true }

	override init(frame frameRect: NSRect) {
		super.init(frame: frameRect)
		setAccessibilityElement(true)
		setAccessibilityRole(.button)
		setAccessibilityLabel("Toby desktop companion")
		setAccessibilityHelp("Open the conversation. Drag to move Toby.")
		toolTip = "Click to ask Toby · Drag to move · Right-click to hide"
	}

	required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

	override func draw(_ dirtyRect: NSRect) {
		CompanionPortraitArtwork.image?.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1,
			respectFlipped: true, hints: nil)
		CompanionEyes.draw(gaze: gaze, in: bounds)
		CompanionMouth.draw(amount: mouth.amount, in: bounds)
	}

	func updateMouth(conversationVisible: Bool, now: TimeInterval, reduceMotion: Bool) {
		let previous = mouth.amount
		mouth.update(conversationVisible: conversationVisible, now: now, reduceMotion: reduceMotion)
		if mouth.amount != previous { needsDisplay = true }
	}

	func resetMouth() {
		mouth = CompanionMouthState()
		needsDisplay = true
	}

	func updateGaze(cursor: CGPoint, engaged: Bool, reduceMotion: Bool) {
		let center = CGPoint(x: bounds.minX + bounds.width * 56.5 / 155,
			y: bounds.minY + bounds.height * 69 / 156)
		let target = engaged || reduceMotion ? CGPoint.zero : CompanionEyes.target(cursor: cursor, center: center)
		let next = reduceMotion ? CGPoint.zero : CompanionEyes.smooth(current: gaze, target: target)
		guard next != gaze else { return }
		gaze = next
		needsDisplay = true
	}

	override func accessibilityPerformPress() -> Bool { open?(); return true }

	override func mouseDown(with event: NSEvent) {
		dragStart = NSEvent.mouseLocation
		originalOrigin = window?.frame.origin
		didDrag = false
	}

	override func mouseDragged(with event: NSEvent) {
		guard let dragStart, let originalOrigin else { return }
		let point = NSEvent.mouseLocation
		let dx = point.x - dragStart.x, dy = point.y - dragStart.y
		guard didDrag || hypot(dx, dy) > 4 else { return }
		didDrag = true
		window?.setFrameOrigin(NSPoint(x: originalOrigin.x + dx, y: originalOrigin.y + dy))
		moved?()
	}

	override func mouseUp(with event: NSEvent) {
		if !didDrag { open?() }
		dragStart = nil
		originalOrigin = nil
	}

	override func rightMouseDown(with event: NSEvent) {
		let menu = NSMenu()
		let item = NSMenuItem(title: "Hide desktop companion", action: #selector(hideCompanion), keyEquivalent: "")
		item.target = self
		menu.addItem(item)
		NSMenu.popUpContextMenu(menu, with: event, for: self)
	}

	@objc private func hideCompanion() { hide?() }
}
