import AppKit
import SwiftUI
import Testing
@testable import TobyApp

@MainActor
@Suite("CommandPalettePanelPlacement")
struct CommandPalettePanelPlacementTests {
	private let size = CommandPalettePanelPlacement.size
	private let screen = NSRect(x: 0, y: 0, width: 1440, height: 900)
	private let visible = NSRect(x: 0, y: 80, width: 1440, height: 795)

	@Test("parseOrigin reads x,y strings and rejects malformed values")
	func parseOrigin() {
		#expect(CommandPalettePanelPlacement.parseOrigin("120.5,340") == NSPoint(x: 120.5, y: 340))
		#expect(CommandPalettePanelPlacement.parseOrigin("0,0") == .zero)
		#expect(CommandPalettePanelPlacement.parseOrigin(nil) == nil)
		#expect(CommandPalettePanelPlacement.parseOrigin("") == nil)
		#expect(CommandPalettePanelPlacement.parseOrigin("120") == nil)
		#expect(CommandPalettePanelPlacement.parseOrigin("a,b") == nil)
	}

	@Test("default origin (0, 0) is never restored even when it overlaps the screen")
	func rejectsDefaultOrigin() {
		#expect(CommandPalettePanelPlacement.isDefaultOrigin(.zero))
		#expect(
			!CommandPalettePanelPlacement.shouldRestoreOrigin(
				.zero,
				size: size,
				visibleFrames: [visible]
			)
		)
		let frame = CommandPalettePanelPlacement.targetFrame(
			savedOrigin: .zero,
			size: size,
			visibleFrames: [visible],
			preferredVisibleFrame: visible
		)
		#expect(frame.origin != .zero)
		#expect(frame.size == size)
		#expect(
			frame.origin
				== CommandPalettePanelPlacement.centeredOrigin(size: size, in: visible)
		)
	}

	@Test("a user-moved on-screen origin is restored")
	func restoresOnScreenOrigin() {
		let origin = NSPoint(x: 200, y: 240)
		#expect(
			CommandPalettePanelPlacement.shouldRestoreOrigin(
				origin,
				size: size,
				visibleFrames: [visible]
			)
		)
		let frame = CommandPalettePanelPlacement.targetFrame(
			savedOrigin: origin,
			size: size,
			visibleFrames: [visible],
			preferredVisibleFrame: visible
		)
		#expect(frame == NSRect(origin: origin, size: size))
	}

	@Test("an origin that no longer overlaps a screen is discarded")
	func rejectsOffScreenOrigin() {
		let origin = NSPoint(x: 8000, y: 8000)
		#expect(
			!CommandPalettePanelPlacement.shouldRestoreOrigin(
				origin,
				size: size,
				visibleFrames: [visible]
			)
		)
		let frame = CommandPalettePanelPlacement.targetFrame(
			savedOrigin: origin,
			size: size,
			visibleFrames: [visible],
			preferredVisibleFrame: visible
		)
		#expect(
			frame.origin
				== CommandPalettePanelPlacement.centeredOrigin(size: size, in: visible)
		)
	}

	@Test("nil saved origin centers on the preferred visible frame")
	func nilOriginCenters() {
		let frame = CommandPalettePanelPlacement.targetFrame(
			savedOrigin: nil,
			size: size,
			visibleFrames: [visible],
			preferredVisibleFrame: visible
		)
		#expect(
			frame.origin
				== CommandPalettePanelPlacement.centeredOrigin(size: size, in: visible)
		)
		#expect(frame.size == size)
	}

	@Test("preferred screen is key window, then mouse, then main")
	func preferredScreenOrder() {
		let key = NSRect(x: 0, y: 0, width: 100, height: 100)
		let otherVisible = NSRect(x: 2000, y: 0, width: 800, height: 600)
		let otherFrame = NSRect(x: 2000, y: 0, width: 800, height: 650)
		let screens = [(frame: screen, visible: visible), (frame: otherFrame, visible: otherVisible)]

		#expect(
			CommandPalettePanelPlacement.preferredVisibleFrame(
				keyWindowVisibleFrame: key,
				mouseLocation: NSPoint(x: 2100, y: 10),
				screens: screens,
				mainVisibleFrame: visible
			) == key
		)
		#expect(
			CommandPalettePanelPlacement.preferredVisibleFrame(
				keyWindowVisibleFrame: nil,
				mouseLocation: NSPoint(x: 2100, y: 10),
				screens: screens,
				mainVisibleFrame: visible
			) == otherVisible
		)
		#expect(
			CommandPalettePanelPlacement.preferredVisibleFrame(
				keyWindowVisibleFrame: nil,
				mouseLocation: NSPoint(x: -50, y: -50),
				screens: screens,
				mainVisibleFrame: visible
			) == visible
		)
	}

	@Test("new panel is created off the default lower-left origin")
	func newPanelIsNotAtOrigin() {
		guard NSScreen.main != nil || !NSScreen.screens.isEmpty else {
			return
		}
		let hosting = NSHostingController(rootView: Text("palette"))
		let panel = CommandPalettePanel(contentViewController: hosting)
		#expect(panel.frame.origin != .zero)
		#expect(panel.frame.size == CommandPalettePanel.panelSize)
		panel.close()
	}
}
