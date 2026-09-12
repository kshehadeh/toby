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
		let hosting = makeHostingController(view)

		if panel == nil {
			let created = CommandPalettePanel(contentViewController: hosting)
			created.onFrameMoved = { [weak self] origin in
				self?.saveOrigin(origin)
			}
			panel = created
		} else {
			panel?.applyContentViewController(hosting)
		}

		guard let panel else { return }
		// Position before and after `orderFront`. A frame set on an unrealized
		// window can be discarded on first display, which would leave the
		// panel at the content-rect origin (lower-left of the primary screen).
		applyPosition(panel)
		panel.makeKeyAndOrderFront(nil)
		panel.orderFrontRegardless()
		applyPosition(panel)
		// Ensure the hosted SwiftUI content receives keyboard focus after the
		// panel becomes key. This complements the view's deferred @FocusState.
		// Re-apply position once layout has run — `NSHostingController` can
		// resize the window on first materialization.
		DispatchQueue.main.async { [weak panel] in
			guard let panel, panel.isVisible else { return }
			self.applyPosition(panel)
			panel.makeKey()
			if let contentView = panel.contentView {
				panel.makeFirstResponder(contentView)
			}
		}
	}

	/// Hides the panel without destroying it (reused on subsequent summons).
	func dismiss() {
		panel?.orderOut(nil)
	}

	private func makeHostingController<Content: View>(_ view: Content) -> NSHostingController<Content> {
		let hosting = NSHostingController(rootView: view)
		// Keep the hosting backing transparent so the rounded card is the only
		// opaque content; the window server derives the (rounded) drop shadow
		// from that alpha.
		hosting.view.wantsLayer = true
		hosting.view.layer?.backgroundColor = NSColor.clear.cgColor
		hosting.view.frame = NSRect(origin: .zero, size: CommandPalettePanelPlacement.size)
		// A fixed-size panel: do not let SwiftUI's first layout pass drive the
		// window frame (that pass is what pinned first-launch to (0, 0)).
		hosting.sizingOptions = []
		return hosting
	}

	/// Restores the last saved origin if it is a real on-screen placement;
	/// otherwise centers on the active screen. Always enforces the fixed panel
	/// size so a reused hosting controller cannot resize the window.
	private func applyPosition(_ panel: CommandPalettePanel) {
		let size = CommandPalettePanelPlacement.size
		let screens = NSScreen.screens.map { (frame: $0.frame, visible: $0.visibleFrame) }
		let preferred = CommandPalettePanelPlacement.preferredVisibleFrame(
			keyWindowVisibleFrame: NSApp.keyWindow?.screen?.visibleFrame,
			mouseLocation: NSEvent.mouseLocation,
			screens: screens,
			mainVisibleFrame: NSScreen.main?.visibleFrame
		) ?? screens.first?.visible ?? NSRect(origin: .zero, size: size)
		let frame = CommandPalettePanelPlacement.targetFrame(
			savedOrigin: savedOrigin(),
			size: size,
			visibleFrames: screens.map(\.visible),
			preferredVisibleFrame: preferred
		)
		panel.applyFrame(frame)
	}

	private func savedOrigin() -> NSPoint? {
		CommandPalettePanelPlacement.parseOrigin(
			UserDefaults.standard.string(forKey: Self.frameOriginKey)
		)
	}

	private func saveOrigin(_ origin: NSPoint) {
		guard !CommandPalettePanelPlacement.isDefaultOrigin(origin) else { return }
		UserDefaults.standard.set(
			CommandPalettePanelPlacement.encodeOrigin(origin),
			forKey: Self.frameOriginKey
		)
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
	static let panelSize = CommandPalettePanelPlacement.size

	/// Invoked whenever the user moves the window (e.g. drags the handle), so
	/// the controller can persist the position. Programmatic `applyFrame`
	/// updates do not fire this.
	var onFrameMoved: (@MainActor (NSPoint) -> Void)?

	/// Suppresses origin persistence while we set the frame or swap the hosting
	/// controller. `setFrame` is also used by AppKit layout, which would
	/// otherwise write the default `(0, 0)` origin to UserDefaults.
	private var isApplyingProgrammaticFrame = false

	init(contentViewController: NSViewController) {
		let size = Self.panelSize
		// Never start at AppKit's default origin (lower-left). Center on the
		// main screen so first `orderFront` cannot flash or stick at (0, 0).
		let visible = NSScreen.main?.visibleFrame
			?? NSScreen.screens.first?.visibleFrame
			?? NSRect(origin: .zero, size: size)
		let origin = CommandPalettePanelPlacement.centeredOrigin(size: size, in: visible)
		super.init(
			contentRect: NSRect(origin: origin, size: size),
			styleMask: [.borderless, .nonactivatingPanel],
			backing: .buffered,
			defer: false
		)
		isApplyingProgrammaticFrame = true
		self.contentViewController = contentViewController
		// `NSHostingController` layout can collapse a newly created window to
		// size `(0, 0)` at the default origin. Re-apply the centered frame so
		// first `orderFront` cannot stick in the lower-left.
		setFrame(NSRect(origin: origin, size: size), display: false)
		isApplyingProgrammaticFrame = false
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

	func applyFrame(_ frame: NSRect) {
		isApplyingProgrammaticFrame = true
		defer { isApplyingProgrammaticFrame = false }
		setFrame(frame, display: true)
	}

	func applyContentViewController(_ controller: NSViewController) {
		let origin = frame.origin
		isApplyingProgrammaticFrame = true
		defer { isApplyingProgrammaticFrame = false }
		contentViewController = controller
		setFrame(NSRect(origin: origin, size: Self.panelSize), display: true)
	}

	/// `performDrag(with:)` moves the window through `setFrame`, so this is the
	/// reliable hook for persisting the position as the user drags.
	override func setFrame(_ frameRect: NSRect, display flag: Bool) {
		super.setFrame(frameRect, display: flag)
		persistOriginIfNeeded(frameRect.origin)
	}

	private func persistOriginIfNeeded(_ origin: NSPoint) {
		guard !isApplyingProgrammaticFrame else { return }
		guard !CommandPalettePanelPlacement.isDefaultOrigin(origin) else { return }
		onFrameMoved?(origin)
	}

	deinit {
		NotificationCenter.default.removeObserver(self)
	}
}
