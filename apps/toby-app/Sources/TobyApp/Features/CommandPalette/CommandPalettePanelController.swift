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

	private init() {}

	/// Presents the command palette hosted in `content`.
	/// Brings Toby to the front so the panel receives keyboard focus.
	func show<Content: View>(@ViewBuilder content: () -> Content) {
		NSApp.activate(ignoringOtherApps: true)

		let view = content()
		let hosting = NSHostingController(rootView: view)

		if panel == nil {
			panel = CommandPalettePanel(contentViewController: hosting)
		} else {
			panel?.contentViewController = hosting
		}

		guard let panel else { return }
		panel.centerOnActiveScreen()
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
}

/// A borderless, Spotlight-like panel that:
/// - has no title bar or stoplight buttons,
/// - floats above normal windows and joins all Spaces,
/// - becomes key so its hosted SwiftUI receives keyboard input,
/// - dismisses itself when it resigns key (click outside) or the app deactivates.
final class CommandPalettePanel: NSPanel {
	override var canBecomeKey: Bool { true }
	override var canBecomeMain: Bool { false }

	init(contentViewController: NSViewController) {
		super.init(
			contentRect: NSRect(x: 0, y: 0, width: 580, height: 440),
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
