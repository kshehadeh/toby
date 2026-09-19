import AppKit

/// Colored recording/processing dot overlaid on the menu bar extra or Dock tile
/// without replacing the underlying icon.
@MainActor
enum RecordingIndicatorOverlay {
	static let identifier = NSUserInterfaceItemIdentifier("recording-indicator-overlay")
	static let menuBarDotFraction: CGFloat = 0.45
	static let dockDotFraction: CGFloat = 0.4

	static func color(for state: RecordingChromeState) -> NSColor? {
		switch state {
		case .idle: nil
		case .recording: .systemRed
		case .processing: .systemOrange
		}
	}

	nonisolated static func overlayRect(
		in size: NSSize,
		dotFraction: CGFloat,
		flipped: Bool,
	) -> NSRect {
		let radius = min(size.width, size.height) * dotFraction * 0.5
		let width = radius * 1.2
		let height = radius * 1.2
		let x = size.width - radius * 1.6
		let yUnflipped = size.height - radius * 1.6
		let y = flipped ? size.height - yUnflipped - height : yUnflipped
		return NSRect(x: x, y: y, width: width, height: height)
	}

	static func apply(to host: NSView, color: NSColor?, dotFraction: CGFloat) {
		let existing = host.subviews.first { $0.identifier == identifier } as? RecordingIndicatorDotView
		guard let color else {
			existing?.removeFromSuperview()
			return
		}
		let overlay = existing ?? RecordingIndicatorDotView()
		overlay.identifier = identifier
		overlay.dotFraction = dotFraction
		overlay.color = color
		overlay.autoresizingMask = host.isFlipped ? [.minXMargin, .maxYMargin] : [.minXMargin, .minYMargin]
		if overlay.superview !== host {
			host.addSubview(overlay)
		}
		overlay.reposition()
	}

	static func isInstalled(on host: NSView) -> Bool {
		host.subviews.contains { $0.identifier == identifier }
	}

	static func applyToDockTile(color: NSColor?) {
		let tile = NSApp.dockTile
		guard let color else {
			tile.contentView = nil
			tile.display()
			return
		}
		if let existing = tile.contentView as? RecordingDockTileView {
			existing.setIndicatorColor(color)
			tile.display()
			return
		}
		let view = RecordingDockTileView(icon: dockIconImage(), color: color)
		view.setFrameSize(tile.size)
		tile.contentView = view
		tile.display()
	}

	static var isInstalledOnDock: Bool {
		NSApp.dockTile.contentView is RecordingDockTileView
	}

	private static func dockIconImage() -> NSImage {
		if let image = NSApp.applicationIconImage, image.size != .zero {
			return image
		}
		return NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath)
	}
}

final class RecordingIndicatorDotView: NSView {
	var color: NSColor = .systemRed {
		didSet { needsDisplay = true }
	}

	var dotFraction: CGFloat = RecordingIndicatorOverlay.menuBarDotFraction

	override var isOpaque: Bool { false }
	override var wantsDefaultClipping: Bool { false }

	override init(frame frameRect: NSRect) {
		super.init(frame: frameRect)
		identifier = RecordingIndicatorOverlay.identifier
		setAccessibilityElement(false)
	}

	@available(*, unavailable)
	required init?(coder: NSCoder) {
		fatalError("init(coder:) has not been implemented")
	}

	override func hitTest(_ point: NSPoint) -> NSView? { nil }

	override func resize(withOldSuperviewSize oldSize: NSSize) {
		super.resize(withOldSuperviewSize: oldSize)
		reposition()
	}

	override func viewDidMoveToSuperview() {
		super.viewDidMoveToSuperview()
		reposition()
	}

	func reposition() {
		guard let superview else { return }
		frame = RecordingIndicatorOverlay.overlayRect(
			in: superview.bounds.size,
			dotFraction: dotFraction,
			flipped: superview.isFlipped,
		)
	}

	override func draw(_ dirtyRect: NSRect) {
		let fillRect = bounds.insetBy(dx: 1, dy: 1)
		guard fillRect.width > 0, fillRect.height > 0 else { return }
		color.setFill()
		NSBezierPath(ovalIn: fillRect).fill()
		NSColor.white.withAlphaComponent(0.9).setStroke()
		let border = NSBezierPath(ovalIn: fillRect)
		border.lineWidth = 1
		border.stroke()
	}
}

final class RecordingDockTileView: NSView {
	private let iconView = NSImageView()
	private let overlay = RecordingIndicatorDotView()

	init(icon: NSImage, color: NSColor) {
		super.init(frame: .zero)
		autoresizingMask = [.width, .height]
		iconView.image = icon
		iconView.imageScaling = .scaleProportionallyUpOrDown
		iconView.imageAlignment = .alignCenter
		iconView.autoresizingMask = [.width, .height]
		addSubview(iconView)
		overlay.dotFraction = RecordingIndicatorOverlay.dockDotFraction
		overlay.color = color
		addSubview(overlay)
	}

	@available(*, unavailable)
	required init?(coder: NSCoder) {
		fatalError("init(coder:) has not been implemented")
	}

	func setIndicatorColor(_ color: NSColor) {
		overlay.color = color
	}

	override func layout() {
		super.layout()
		iconView.frame = bounds
		overlay.reposition()
	}
}
