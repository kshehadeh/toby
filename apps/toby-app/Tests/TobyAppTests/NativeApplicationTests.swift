import Foundation
import Testing
@testable import TobyApp

@Suite("Native application tools")
@MainActor
struct NativeApplicationTests {
	private func decode(_ data: Data) throws -> [String: Any] {
		try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
	}

	@Test("quit rejects missing and blank names without terminating anything")
	func missingQuitTarget() throws {
		for body in [nil, Data(#"{"appName":"   "}"#.utf8)] as [Data?] {
			let response = try decode(NativeMacOSHandler.appQuit(body: body))
			#expect(response["ok"] as? Bool == false)
			#expect(response["error"] as? String == "appName is required.")
		}
	}

	@Test("quit requires an exact running app match")
	func unmatchedQuitTarget() throws {
		let response = try decode(NativeMacOSHandler.appQuit(body: Data(#"{"appName":"dev.toby.nonexistent-test-application"}"#.utf8)))
		#expect(response["ok"] as? Bool == false)
		#expect((response["error"] as? String)?.contains("No running application exactly matched") == true)
	}

	@Test("running app list returns an empty successful result for an unmatched filter")
	func unmatchedListFilter() throws {
		let response = try decode(NativeMacOSHandler.appsRunning(body: Data(#"{"appName":"dev.toby.nonexistent-test-application","includeBackground":true}"#.utf8)))
		#expect(response["ok"] as? Bool == true)
		let data = try #require(response["data"] as? [String: Any])
		#expect(data["count"] as? Int == 0)
		#expect((data["apps"] as? [[String: Any]])?.isEmpty == true)
	}

	@Test("default list contains only regular apps and process/status information")
	func regularAppInfo() throws {
		let response = try decode(NativeMacOSHandler.appsRunning(body: nil))
		let data = try #require(response["data"] as? [String: Any])
		let apps = try #require(data["apps"] as? [[String: Any]])
		#expect(data["count"] as? Int == apps.count)
		for app in apps {
			#expect(app["activationPolicy"] as? String == "regular")
			#expect(app["processIdentifier"] as? Int != nil)
			#expect(app["isHidden"] as? Bool != nil)
			#expect(app["isActive"] as? Bool != nil)
			#expect(app["secondsSinceLastFocus"] != nil)
			if app["isActive"] as? Bool == true {
				#expect(app["secondsSinceLastFocus"] as? Double == 0)
			}
		}
	}

	@Test("focus history distinguishes unknown, active, and previously focused apps")
	func focusTiming() {
		var history = AppFocusHistory()
		let date = Date(timeIntervalSince1970: 1_000)
		let app = AppFocusHistory.Process(identifier: 123, launchDate: date)
		#expect(history.secondsSinceFocus(app, isActive: false, now: date) == nil)
		#expect(history.secondsSinceFocus(app, isActive: true, now: date) == 0)
		history.record(app, at: date)
		#expect(history.secondsSinceFocus(app, isActive: false, now: date.addingTimeInterval(90)) == 90)
		// Losing focus updates the timestamp even after a long interval with focus.
		history.record(app, at: date.addingTimeInterval(100))
		#expect(history.secondsSinceFocus(app, isActive: false, now: date.addingTimeInterval(110)) == 10)
		#expect(history.secondsSinceFocus(app, isActive: false, now: date) == 0)
	}

	@Test("focus history does not transfer to a relaunched process and clears on termination")
	func focusLifecycle() {
		var history = AppFocusHistory()
		let date = Date(timeIntervalSince1970: 1_000)
		let app = AppFocusHistory.Process(identifier: 123, launchDate: date)
		history.record(app, at: date)
		let relaunched = AppFocusHistory.Process(identifier: 123, launchDate: date.addingTimeInterval(1))
		#expect(history.secondsSinceFocus(relaunched, isActive: false, now: date) == nil)
		history.remove(app)
		#expect(history.secondsSinceFocus(app, isActive: false, now: date) == nil)
	}
}
