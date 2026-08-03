import AppKit
import SwiftUI

/// Owns the Spotlight-style borderless `NSPanel` that hosts the command
/// palette when summoned system-wide.
///
/// The panel has no title bar or stoplight buttons, floats above normal app
/// windows, joins all Spaces, and dismisses on Escape, when it resigns key
/// (click outside), or when Toby deactivates.
@MainActor
final class CommandPalettePanelController {
	static let shared = CommandPalettePanelController()

	private var panel: CommandPalettePanel?

	/// UserDefaults key holding the last panel origin as "x,y".
	private static let frameOriginKey = "toby.commandPalette.frameOrigin"

	private init() {}

	/// Presents the command palette hosted in `content`.
	///
	/// The panel is a non-activating panel, so it becomes key and receives
	/// keyboard input without activating Toby or bringing the main window to
	/// the front — matching the Spotlight experience. Selecting an action is
	/// responsible for surfacing the main window when needed.
	func show<Content: View>(@ViewBuilder content: () -> Content) {
		let view = content()
		let hosting = NSHostingController(rootView: view)
		// Keep the hosting backing transparent so the rounded card is the only
		// opaque content; the window server derives the (rounded) drop shadow
		// from that alpha.
		hosting.view.wantsLayer = true
		hosting.view.layer?.backgroundColor = NSColor.clear.cgColor

		if panel == nil {
			let created = CommandPalettePanel(contentViewController: hosting)
			created.onFrameMoved = { [weak self] origin in
				self?.saveOrigin(origin)
			}
			panel = created
		} else {
			panel?.contentViewController = hosting
		}

		guard let panel else { return }
		positionPanel(panel)
		panel.makeKeyAndOrderFront(nil)
		panel.orderFrontRegardless()
		// Ensure the hosted SwiftUI content receives keyboard focus after the
		// panel becomes key. This complements the view's deferred @FocusState.
		DispatchQueue.main.async {
			if let contentView = panel.contentView {
				panel.makeFirstResponder(contentView)
			}
		}
	}

	/// Hides the panel without destroying it (reused on subsequent summons).
	func dismiss() {
		panel?.orderOut(nil)
	}

	/// Restores the last saved origin if it lands on a currently visible
	/// screen; otherwise centers on the active screen. Enforces the fixed panel
	/// size in case reusing the content view controller resized the window.
	private func positionPanel(_ panel: CommandPalettePanel) {
		let size = CommandPalettePanel.panelSize
		if let origin = savedOrigin(),
			isFrameVisible(NSRect(origin: origin, size: size))
		{
			panel.setFrame(NSRect(origin: origin, size: size), display: false)
		} else {
			panel.setContentSize(size)
			panel.centerOnActiveScreen()
		}
	}

	private func savedOrigin() -> NSPoint? {
		guard let raw = UserDefaults.standard.string(forKey: Self.frameOriginKey) else {
			return nil
		}
		let parts = raw.split(separator: ",")
		guard parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) else {
			return nil
		}
		return NSPoint(x: x, y: y)
	}

	private func saveOrigin(_ origin: NSPoint) {
		UserDefaults.standard.set("\(origin.x),\(origin.y)", forKey: Self.frameOriginKey)
	}

	/// True when a meaningful portion of `frame` overlaps a visible screen, so
	/// a restored position never lands the palette off-screen (e.g. after a
	/// display is disconnected).
	private func isFrameVisible(_ frame: NSRect) -> Bool {
		let frameArea = frame.width * frame.height
		guard frameArea > 0 else { return false }
		for screen in NSScreen.screens {
			let intersection = screen.visibleFrame.intersection(frame)
			let area = intersection.width * intersection.height
			if area >= frameArea * 0.5 { return true }
		}
		return false
	}
}

/// A borderless, Spotlight-like panel that:
/// - has no title bar or stoplight buttons,
/// - floats above normal windows and joins all Spaces,
/// - becomes key so its hosted SwiftUI receives keyboard input,
/// - dismisses itself when it resigns key (click outside) or the app deactivates.
final class CommandPalettePanel: NSPanel {
	override var canBecomeKey: Bool { true }
	override var canBecomeMain: Bool { false }

	/// Matches the SwiftUI card's fixed `.frame(width:height:)`. The window is
	/// sized exactly to the card so the only opaque content is the rounded card
	/// itself — no oversized transparent margin whose clipped shadow would show
	/// as squared edges over bright backdrops.
	static let panelSize = NSSize(width: 560, height: 420)

	/// Invoked whenever the window frame changes (e.g. the user drags it), so
	/// the controller can persist the position.
	var onFrameMoved: (@MainActor (NSPoint) -> Void)?

	init(contentViewController: NSViewController) {
		super.init(
			contentRect: NSRect(origin: .zero, size: Self.panelSize),
			styleMask: [.borderless, .nonactivatingPanel],
			backing: .buffered,
			defer: false
		)
		self.contentViewController = contentViewController
		self.isFloatingPanel = true
		self.becomesKeyOnlyIfNeeded = false
		self.level = .floating
		self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
		self.isOpaque = false
		self.backgroundColor = .clear
		// The window is sized exactly to the rounded card, so the window
		// server derives a correctly rounded drop shadow from the card's alpha
		// (unlike a SwiftUI shadow, which the hosting layer clips to a square).
		self.hasShadow = true
		self.isMovableByWindowBackground = false
		self.hidesOnDeactivate = true
		self.animationBehavior = .utilityWindow
		// No standard window chrome — the SwiftUI content draws its own rounded card.
		self.titlebarAppearsTransparent = true
		self.titleVisibility = .hidden
	}

	/// Dismiss when the panel resigns key (user clicked another window/app).
	override func resignKey() {
		super.resignKey()
		orderOut(nil)
	}

	/// Allow the hosted SwiftUI view's `.onExitCommand` to receive Escape.
	override func cancelOperation(_ sender: Any?) {
		orderOut(nil)
	}

	/// `performDrag(with:)` moves the window through `setFrame`, so this is the
	/// reliable hook for persisting the position as the user drags.
	override func setFrame(_ frameRect: NSRect, display flag: Bool) {
		super.setFrame(frameRect, display: flag)
		onFrameMoved?(frameRect.origin)
	}

	deinit {
		NotificationCenter.default.removeObserver(self)
	}
}

extension CommandPalettePanel {
	/// Centers the panel on the screen that currently contains the key window,
	/// falling back to the screen under the mouse cursor (important when invoked
	/// via a global hotkey while another app is frontmost), then the main screen.
	func centerOnActiveScreen() {
		let mouseLocation = NSEvent.mouseLocation
		let screen = NSApp.keyWindow?.screen
			?? NSScreen.screens.first(where: { $0.frame.contains(mouseLocation) })
			?? NSScreen.main
			?? NSScreen.screens.first
		guard let screen else { return }
		let visible = screen.visibleFrame
		let origin = NSPoint(
			x: visible.midX - frame.width / 2,
			y: visible.midY - frame.height / 2
		)
		setFrameOrigin(origin)
	}
}
