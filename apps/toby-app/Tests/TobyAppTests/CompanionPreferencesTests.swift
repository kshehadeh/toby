import AppKit
import Testing
@testable import TobyApp

@MainActor
@Suite("Toby's Head preferences")
struct CompanionPreferencesTests {
	private func withDefaults(_ body: (UserDefaults) throws -> Void) throws {
		let name = "toby.tests.head.\(UUID().uuidString)"
		let defaults = try #require(UserDefaults(suiteName: name))
		defer { defaults.removePersistentDomain(forName: name) }
		try body(defaults)
	}

	@Test("First launch shows the head near the lower-right corner")
	func firstLaunch() throws {
		try withDefaults { defaults in
			let preferences = CompanionPreferences(defaults: defaults)
			let screen = NSRect(x: 50, y: 80, width: 1440, height: 820)
			#expect(preferences.isVisible)
			#expect(preferences.origin == nil)
			let frame = preferences.initialFrame(in: screen)
			#expect(frame.maxX == screen.maxX - 28)
			#expect(frame.minY == screen.minY + 40)
			#expect(screen.contains(frame))
		}
	}

	@Test("Show/hide choices and the existing position key survive new preference instances")
	func persistence() throws {
		try withDefaults { defaults in
			defaults.set("123.5,234.5", forKey: "toby.companion.origin")
			let preferences = CompanionPreferences(defaults: defaults)
			#expect(preferences.origin == NSPoint(x: 123.5, y: 234.5))
			preferences.isVisible = false
			preferences.origin = NSPoint(x: -500, y: 180)
			let restored = CompanionPreferences(defaults: defaults)
			#expect(!restored.isVisible && restored.origin == NSPoint(x: -500, y: 180))
			restored.isVisible = true
			#expect(CompanionPreferences(defaults: defaults).isVisible)
		}
	}

	@Test("Restore keeps secondary-display positions and recovers disconnected displays")
	func screenRecovery() throws {
		try withDefaults { defaults in
			let preferences = CompanionPreferences(defaults: defaults)
			let main = NSRect(x: 0, y: 80, width: 1440, height: 820)
			let secondary = NSRect(x: -1440, y: 80, width: 1440, height: 820)
			preferences.origin = NSPoint(x: -500, y: 180)
			let restored = preferences.initialFrame(in: main, visibleFrames: [main, secondary])
			#expect(restored.origin == preferences.origin)
			#expect(secondary.contains(restored))
			#expect(main.contains(preferences.initialFrame(in: main, visibleFrames: [main])))
			defaults.set("nan,inf", forKey: "toby.companion.origin")
			#expect(preferences.origin == nil)
			#expect(preferences.initialFrame(in: main).maxX == main.maxX - 28)
		}
	}

	@Test("Hidden startup restoration is applied only once across scene appearances")
	func oneTimeRestoration() throws {
		try withDefaults { defaults in
			let preferences = CompanionPreferences(defaults: defaults)
			preferences.isVisible = false
			let controller = CompanionPanelController(defaults: defaults)
			controller.restoreVisibility()
			#expect(!controller.isVisible)
			preferences.isVisible = true
			controller.restoreVisibility()
			#expect(!controller.isVisible)
			controller.hide()
			#expect(!CompanionPreferences(defaults: defaults).isVisible)
		}
	}
}
