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
		}
	}
}
