import AppKit
import Observation
import SwiftUI

/// App-owned auxiliary surfaces, like the command palette. No titled scene is
/// created: the window bounds contain only the cutout and conversation artwork.
@Observable @MainActor
final class CompanionPanelController: NSObject {
	static let shared = CompanionPanelController()
	private(set) var isVisible = false
	let store = CompanionStore()
	private var face: NSPanel?
	private var bubble: CompanionConversationPanel?
	private var pointerTimer: Timer?
	private let preferences: CompanionPreferences
	private var hasRestoredVisibility = false

	init(defaults: UserDefaults = .standard) {
		preferences = CompanionPreferences(defaults: defaults)
		super.init()
		observeBubbleSize()
		NotificationCenter.default.addObserver(self, selector: #selector(askFromShortcut),
			name: .askCompanion, object: nil)
		NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
			name: NSApplication.didChangeScreenParametersNotification, object: nil)
		NotificationCenter.default.addObserver(self, selector: #selector(homeChanged),
			name: .tobyHomeDidChange, object: nil)
	}

	func toggle() { isVisible ? hide() : show() }

	func restoreVisibility() {
		guard !hasRestoredVisibility else { return }
		hasRestoredVisibility = true
		if preferences.isVisible { show() }
	}

	func show() {
		guard !isVisible else { return }
		if face == nil {
			let panel = makePanel(size: CompanionGeometry.faceSize)
			let view = CompanionPortraitView(frame: NSRect(origin: .zero, size: CompanionGeometry.faceSize))
			view.open = { [weak self] in self?.toggleConversation() }
			view.moved = { [weak self] in self?.faceMoved() }
			view.hide = { [weak self] in self?.hide() }
			panel.contentView = view
			face = panel
			let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1024, height: 768)
			panel.setFrame(preferences.initialFrame(in: screen, visibleFrames: NSScreen.screens.map(\.visibleFrame)), display: false)
		}
		isVisible = true
		preferences.isVisible = true
		screensChanged()
		updatePointerBoundary()
		face?.orderFrontRegardless()
		let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
			Task { @MainActor in self?.updatePointerBoundary() }
		}
		RunLoop.main.add(timer, forMode: .common)
		pointerTimer = timer
	}

	func hide() {
		if let face { preferences.origin = face.frame.origin }
		preferences.isVisible = false
		isVisible = false
		pointerTimer?.invalidate()
		pointerTimer = nil
		face?.orderOut(nil)
		closeConversation()
		(face?.contentView as? CompanionPortraitView)?.resetExpressions()
	}

	func closeConversation() { bubble?.orderOut(nil) }

	@objc private func askFromShortcut() { ask() }

	func ask() {
		show()
		if bubble?.isVisible != true { toggleConversation() }
		else {
			bubble?.makeKeyAndOrderFront(nil)
			store.presentationID = UUID()
		}
	}

	private func toggleConversation() {
		if bubble?.isVisible == true { closeConversation(); return }
		if bubble == nil {
			let panel = CompanionConversationPanel(contentRect: NSRect(origin: .zero, size: CompanionGeometry.bubbleSize),
				styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
			configure(panel)
			panel.title = "Ask Toby"
			panel.onDismiss = { [weak self] in self?.closeConversation() }
			panel.contentView = Self.makeBubbleHostingView(rootView: CompanionBubbleView(store: store,
				close: { [weak self] in self?.closeConversation() }, hide: { [weak self] in self?.hide() })
				.tobyAppearance(AppearancePreferences.shared))
			bubble = panel
		}
		placeBubble()
		bubble?.makeKeyAndOrderFront(nil)
		store.presentationID = UUID()
	}

	static func makeBubbleHostingView<Content: View>(rootView: Content) -> NSHostingView<Content> {
		let hosting = NSHostingView(rootView: rootView)
		// placeBubble owns the size and screen-clamped origin. Automatic hosting
		// resize can otherwise grow the window downward after that placement.
		hosting.sizingOptions = []
		return hosting
	}

	private func observeBubbleSize() {
		// A modifier created once outside a SwiftUI body does not observe the
		// store's changing size. Track it here, where window placement is owned.
		withObservationTracking {
			_ = store.bubbleSize
		} onChange: { [weak self] in
			Task { @MainActor [weak self] in
				self?.placeBubble()
				self?.observeBubbleSize()
			}
		}
	}

	private func makePanel(size: NSSize) -> NSPanel {
		let panel = NSPanel(contentRect: NSRect(origin: .zero, size: size),
			styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
		configure(panel)
		panel.title = "Toby's Head"
		return panel
	}

	private func configure(_ panel: NSPanel) {
		panel.isOpaque = false
		panel.backgroundColor = .clear
		panel.hasShadow = false
		panel.level = .floating
		panel.isFloatingPanel = true
		panel.hidesOnDeactivate = false
		panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
		panel.isReleasedWhenClosed = false
	}

	private func updatePointerBoundary() {
		guard let face, let view = face.contentView, isVisible else { return }
		let point = view.convert(face.convertPoint(fromScreen: NSEvent.mouseLocation), from: nil)
		let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
		let engaged = bubble?.isVisible == true
		(view as? CompanionPortraitView)?.updateGaze(cursor: point, engaged: engaged, reduceMotion: reduceMotion)
		(view as? CompanionPortraitView)?.updateMouth(conversationVisible: engaged,
			now: ProcessInfo.processInfo.systemUptime, reduceMotion: reduceMotion, streamingText: store.speakingText)
		(view as? CompanionPortraitView)?.updateEyebrows(processing: store.isProcessingResponse, reduceMotion: reduceMotion)
		guard NSEvent.pressedMouseButtons == 0 else { return }
		guard (view as? CompanionPortraitView)?.isDragging != true else { return }
		// Returning nil from NSView.hitTest alone cannot pass clicks to another
		// app. Switch window-server mouse handling outside the visible silhouette.
		face.ignoresMouseEvents = !CompanionPortraitArtwork.contains(point, in: view.bounds)
		if let bubble, bubble.isVisible, let content = bubble.contentView {
			let point = content.convert(bubble.convertPoint(fromScreen: NSEvent.mouseLocation), from: nil)
			// NSHostingView uses bottom-left coordinates; the SwiftUI shape uses top-left.
			let topPoint = NSPoint(x: point.x, y: content.isFlipped ? point.y : content.bounds.height - point.y)
			bubble.ignoresMouseEvents = !CompanionBubbleShape(pointsRight: store.bubblePointsRight, tailY: store.bubbleTailY)
				.path(in: content.bounds).contains(topPoint)
		}
	}

	private func faceMoved() {
		guard let face else { return }
		if let screen = face.screen?.visibleFrame {
			face.setFrame(CompanionGeometry.clamp(face.frame, to: screen), display: true)
		}
		preferences.origin = face.frame.origin
		placeBubble()
	}

	private func placeBubble() {
		guard let face, let bubble, let screen = face.screen?.visibleFrame ?? NSScreen.main?.visibleFrame else { return }
		let frame = CompanionGeometry.bubbleFrame(face: face.frame, screen: screen, size: store.bubbleSize)
		store.bubblePointsRight = frame.midX < face.frame.midX
		store.bubbleTailY = min(max(frame.maxY - face.frame.midY, 36), frame.height - 36)
		bubble.setFrame(frame, display: true)
	}

	@objc private func homeChanged() {
		store.resetForHomeSwitch()
		placeBubble()
	}

	@objc private func screensChanged() {
		guard let face else { return }
		let screen = NSScreen.screens.first { $0.visibleFrame.intersects(face.frame) } ?? NSScreen.main
		guard let screen else { return }
		face.setFrame(CompanionGeometry.clamp(face.frame, to: screen.visibleFrame), display: true)
		preferences.origin = face.frame.origin
		placeBubble()
	}
}

private final class CompanionConversationPanel: NSPanel {
	var onDismiss: (() -> Void)?
	override var canBecomeKey: Bool { true }
	override var canBecomeMain: Bool { false }
	override func resignKey() { super.resignKey(); onDismiss?() }
	override func cancelOperation(_ sender: Any?) { onDismiss?() }
}
