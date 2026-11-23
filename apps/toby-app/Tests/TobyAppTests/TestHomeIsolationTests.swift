import Foundation
import Testing
import TobyStore
@testable import TobyApp

@MainActor
@Suite("Test home isolation")
struct TestHomeIsolationTests {
	@Test("tests never resolve the real ~/.toby")
	func testsUseATemporaryHome() {
		#expect(TobyPaths.isRunningTests())
		let real = FileManager.default.homeDirectoryForCurrentUser.appending(path: ".toby").path
		if ProcessInfo.processInfo.environment["TOBY_DIR"] == nil {
			#expect(TobyPaths.current().root.path != real)
			#expect(NativeRuntime.shared.paths.root.path != real)
		}
	}
}
