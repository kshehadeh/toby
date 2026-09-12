import AppKit
import Foundation

/// Geometry helpers for the Spotlight-style command palette panel.
///
/// Extracted so first-display positioning can be tested without realizing an
/// `NSPanel`. AppKit's default window origin is `(0, 0)` — the lower-left of
/// the primary display — so an unrealized panel (or a hosting-controller
/// layout pass) can land there unless we explicitly reject and replace it.
enum CommandPalettePanelPlacement {
	/// Matches `CommandPaletteView`'s fixed `.frame(width:height:)`.
	static let size = NSSize(width: 560, height: 420)

	static func parseOrigin(_ raw: String?) -> NSPoint? {
		guard let raw else { return nil }
		let parts = raw.split(separator: ",")
		guard parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) else {
			return nil
		}
		return NSPoint(x: x, y: y)
	}

	static func encodeOrigin(_ origin: NSPoint) -> String {
		"\(origin.x),\(origin.y)"
	}

	/// True when `origin` is the AppKit default and must not be restored.
	static func isDefaultOrigin(_ origin: NSPoint) -> Bool {
		origin == .zero
	}

	/// Restores a saved origin only when it is a real user placement that still
	/// overlaps a visible screen. `(0, 0)` is treated as unset — that is the
	/// content-rect origin of a newly created `NSWindow`, not a deliberate
	/// lower-left placement, and a 560×420 rect there still passes a naive
	/// 50%-overlap check against the primary display.
	static func shouldRestoreOrigin(
		_ origin: NSPoint,
		size: NSSize,
		visibleFrames: [NSRect]
	) -> Bool {
		guard !isDefaultOrigin(origin) else { return false }
		return isFrameVisible(NSRect(origin: origin, size: size), visibleFrames: visibleFrames)
	}

	static func isFrameVisible(_ frame: NSRect, visibleFrames: [NSRect]) -> Bool {
		let frameArea = frame.width * frame.height
		guard frameArea > 0 else { return false }
		for visible in visibleFrames {
			let intersection = visible.intersection(frame)
			let area = intersection.width * intersection.height
			if area >= frameArea * 0.5 { return true }
		}
		return false
	}

	static func centeredOrigin(size: NSSize, in visibleFrame: NSRect) -> NSPoint {
		NSPoint(
			x: visibleFrame.midX - size.width / 2,
			y: visibleFrame.midY - size.height / 2
		)
	}

	static func targetFrame(
		savedOrigin: NSPoint?,
		size: NSSize,
		visibleFrames: [NSRect],
		preferredVisibleFrame: NSRect
	) -> NSRect {
		if let origin = savedOrigin,
			shouldRestoreOrigin(origin, size: size, visibleFrames: visibleFrames)
		{
			return NSRect(origin: origin, size: size)
		}
		return NSRect(
			origin: centeredOrigin(size: size, in: preferredVisibleFrame),
			size: size
		)
	}

	/// Screen used to center a first-show (or invalid-restore) panel: the key
	/// window's screen, else the screen under the cursor, else the main screen.
	static func preferredVisibleFrame(
		keyWindowVisibleFrame: NSRect?,
		mouseLocation: NSPoint,
		screens: [(frame: NSRect, visible: NSRect)],
		mainVisibleFrame: NSRect?
	) -> NSRect? {
		if let keyWindowVisibleFrame { return keyWindowVisibleFrame }
		if let hit = screens.first(where: { $0.frame.contains(mouseLocation) }) {
			return hit.visible
		}
		return mainVisibleFrame ?? screens.first?.visible
	}
}
