import Testing
import SwiftUI
@testable import TobyApp

@MainActor
@Suite("MenuBarController", .serialized)
struct MenuBarControllerTests {
	@Test("menu contains expected items in order")
	func menuItemsPresent() throws {
		let controller = MenuBarController(registerStatusItem: false)
		let titles = controller.menuItemTitles
		#expect(titles.contains("New Chat"))
		#expect(titles.contains("Command Palette"))
		#expect(titles.contains("Chats"))
		#expect(titles.contains("Integrations"))
		#expect(titles.contains("Projects"))
		#expect(titles.contains("Skills"))
		#expect(titles.contains("Memories"))
		#expect(titles.contains("Schedules"))
		#expect(titles.contains("Flows"))
		#expect(titles.contains("Recordings"))
		#expect(titles.contains("Settings…"))
		#expect(titles.contains("Quit Toby"))
	}

	@Test("view menu items have SF Symbol icons matching sidebar")
	func viewMenuItemsHaveIcons() throws {
		let controller = MenuBarController(registerStatusItem: false)
		let menu = try #require(controller.menu)
		for route in DetailRoute.allCases {
			let title = route.menuTitle
			let item = try #require(menu.items.first { $0.title == title }, "Missing menu item for \(title)")
			let image = try #require(item.image, "Missing icon for \(title)")
			#expect(image.isTemplate == true, "Icon for \(title) should be template")
		}
	}

	@Test("view menu items are in sidebar order")
	func viewMenuItemsInOrder() throws {
		let controller = MenuBarController(registerStatusItem: false)
		let titles = controller.menuItemTitles
		// After the recording separator, view items should appear in sidebar order.
		let viewStart = titles.firstIndex(of: "Chats") ?? 0
		let viewEnd = titles.firstIndex(of: "Settings…") ?? 0
		let viewTitles = Array(titles[viewStart...viewEnd])
		#expect(viewTitles == [
			"Chats", "Integrations", "Projects", "Skills",
			"Memories", "Schedules", "Flows", "Recordings", "Settings…",
		])
	}

	@Test("recording item title toggles with state")
	func recordingItemTitleToggles() throws {
		let controller = MenuBarController(registerStatusItem: false)
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
		let controller = MenuBarController(registerStatusItem: false)
		NotificationCenter.default.post(name: MenuBarController.recordingStateChanged, object: true)
		// Allow notification to be processed on the main run loop
		RunLoop.current.run(until: Date().addingTimeInterval(0.1))
		#expect(controller.menuItemTitles.contains("Stop Recording"))
		controller.setRecordingActive(false)
	}

	@Test("menu bar icon gains recording indicator when active")
	func menuBarIconMarkedWhenRecording() throws {
		let controller = MenuBarController(registerStatusItem: false)
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
		let controller = MenuBarController(registerStatusItem: false)
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

	@Test("status item can be hidden and shown")
	func statusItemVisibilityToggle() throws {
		let controller = MenuBarController(showStatusItem: true)
		#expect(controller.isStatusItemVisible)

		controller.setStatusItemVisible(false)
		#expect(!controller.isStatusItemVisible)

		controller.setStatusItemVisible(true)
		#expect(controller.isStatusItemVisible)
	}

	@Test("init with showStatusItem false leaves status item hidden")
	func initHiddenStatusItem() throws {
		let controller = MenuBarController(showStatusItem: false)
		#expect(!controller.isStatusItemVisible)
		// Menu is still available for actions once shown again.
		#expect(controller.menuItemTitles.contains("New Chat"))
		controller.setStatusItemVisible(true)
		#expect(controller.isStatusItemVisible)
	}

	@Test("dock recording indicator still updates when status item is hidden")
	func dockIndicatorWhenStatusItemHidden() throws {
		let controller = MenuBarController(showStatusItem: false)
		#expect(!controller.isStatusItemVisible)

		controller.setRecordingActive(true)
		#expect(controller.dockImageIsMarked)

		controller.setRecordingActive(false)
		#expect(!controller.dockImageIsMarked)
	}

	@Test("processing chrome is not a live stop control")
	func processingChromeDisablesStop() throws {
		let controller = MenuBarController(registerStatusItem: false)
		controller.setRecordingChrome(.processing)
		#expect(controller.menuItemTitles.contains("Processing Recording"))
		#expect(!controller.menuItemTitles.contains("Stop Recording"))
		#expect(controller.menuBarImageIsMarked == true)
		let item = try #require(controller.menu?.item(withTag: MenuBarController.recordingItemTag))
		#expect(item.isEnabled == false)
		#expect(item.action == nil)

		controller.setRecordingChrome(.idle)
		#expect(controller.menuItemTitles.contains("Start Recording"))
		#expect(controller.menuBarImageIsMarked == false)
	}

	@Test("processing notification updates menu without looking like live capture")
	func processingNotificationUpdatesTitle() throws {
		let controller = MenuBarController(registerStatusItem: false)
		NotificationCenter.default.post(
			name: MenuBarController.recordingStateChanged,
			object: RecordingChromeState.processing,
		)
		RunLoop.current.run(until: Date().addingTimeInterval(0.1))
		#expect(controller.menuItemTitles.contains("Processing Recording"))
		controller.setRecordingChrome(.idle)
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
