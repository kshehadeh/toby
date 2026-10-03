import AppKit

/// App-local presentation preferences, retaining the original position key.
struct CompanionPreferences {
	let defaults: UserDefaults
	private let visibleKey = "toby.companion.visible"
	private let originKey = "toby.companion.origin"

	var isVisible: Bool {
		get { defaults.object(forKey: visibleKey) == nil || defaults.bool(forKey: visibleKey) }
		nonmutating set { defaults.set(newValue, forKey: visibleKey) }
	}

	var origin: NSPoint? {
		get {
			guard let point = CommandPalettePanelPlacement.parseOrigin(defaults.string(forKey: originKey)),
				point.x.isFinite, point.y.isFinite else { return nil }
			return point
		}
		nonmutating set {
			if let newValue {
				defaults.set(CommandPalettePanelPlacement.encodeOrigin(newValue), forKey: originKey)
			} else {
				defaults.removeObject(forKey: originKey)
			}
		}
	}

	func initialFrame(in screen: NSRect, visibleFrames: [NSRect] = []) -> NSRect {
		let point = origin ?? NSPoint(x: screen.maxX - CompanionGeometry.faceSize.width - 28, y: screen.minY + 40)
		let frame = NSRect(origin: point, size: CompanionGeometry.faceSize)
		let targetScreen = visibleFrames.first { $0.intersects(frame) } ?? screen
		return CompanionGeometry.clamp(frame, to: targetScreen)
	}
}
