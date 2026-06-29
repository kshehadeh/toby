import Testing
import SwiftUI
@testable import TobyApp

@MainActor
@Suite("MenuBarController", .serialized)
struct MenuBarControllerTests {
	@Test("menu contains expected items in order")
	func menuItemsPresent() throws {
		let controller = MenuBarController()
		let titles = controller.menuItemTitles
		#expect(titles.contains("New Chat"))
		#expect(titles.contains("Recordings"))
		#expect(titles.contains("Schedules"))
		#expect(titles.contains("Integrations"))
		#expect(titles.contains("Settings…"))
		#expect(titles.contains("Quit Toby"))
	}

	@Test("recording item title toggles with state")
	func recordingItemTitleToggles() throws {
		let controller = MenuBarController()
		// Initially "Start Recording"
		#expect(controller.menuItemTitles.contains("Start Recording"))
		// After activating recording -> "Stop Recording"
		controller.setRecordingActive(true)
		#expect(controller.menuItemTitles.contains("Stop Recording"))
		#expect(!controller.menuItemTitles.contains("Start Recording"))
		// After deactivating -> back to "Start Recording"
		controller.setRecordingActive(false)
		#expect(controller.menuItemTitles.contains("Start Recording"))
	}

	@Test("recording state change notification updates title")
	func recordingStateNotificationUpdatesTitle() throws {
		let controller = MenuBarController()
		NotificationCenter.default.post(name: MenuBarController.recordingStateChanged, object: true)
		// Allow notification to be processed on the main run loop
		RunLoop.current.run(until: Date().addingTimeInterval(0.1))
		#expect(controller.menuItemTitles.contains("Stop Recording"))
		controller.setRecordingActive(false)
	}

	@Test("menu bar icon gains recording indicator when active")
	func menuBarIconMarkedWhenRecording() throws {
		let controller = MenuBarController()
		// Initially not marked
		#expect(controller.menuBarImageIsMarked == false)
		// After activating -> marked
		controller.setRecordingActive(true)
		#expect(controller.menuBarImageIsMarked == true)
		// After deactivating -> unmarked
		controller.setRecordingActive(false)
		#expect(controller.menuBarImageIsMarked == false)
	}

	@Test("recording state change notification updates menu bar icon")
	func recordingStateNotificationUpdatesIcon() throws {
		let controller = MenuBarController()
		NotificationCenter.default.post(name: MenuBarController.recordingStateChanged, object: true)
		RunLoop.current.run(until: Date().addingTimeInterval(0.1))
		#expect(controller.menuBarImageIsMarked == true)
		controller.setRecordingActive(false)
	}

	@Test("dock icon recording indicator clears when recording stops")
	func dockIconIndicatorClearsWhenRecordingStops() throws {
		let controller = MenuBarController()
		controller.setRecordingActive(true)
		#expect(controller.dockImageIsMarked)

		controller.setRecordingActive(false)
		#expect(!controller.dockImageIsMarked)
	}

	@Test("recording state change notification clears dock icon")
	func recordingStateNotificationClearsDockIcon() throws {
		let controller = MenuBarController()
		controller.setRecordingActive(true)
		#expect(controller.dockImageIsMarked)

		NotificationCenter.default.post(name: MenuBarController.recordingStateChanged, object: false)
		RunLoop.current.run(until: Date().addingTimeInterval(0.1))
		#expect(!controller.dockImageIsMarked)
	}
}

@MainActor
@Suite("OpenWindowBridge")
struct OpenWindowBridgeTests {
	@Test("openWindow closure is invoked with id")
	func openWindowClosureInvoked() throws {
		let bridge = OpenWindowBridge.shared
		var capturedId: String?
		bridge.openWindow = { id in capturedId = id }
		bridge.openWindow?("test-window")
		#expect(capturedId == "test-window")
		// Cleanup
		bridge.openWindow = nil
	}
}
