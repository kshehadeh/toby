import Foundation
import Testing
@testable import TobyApp

@Suite("DaemonBootstrap")
struct DaemonBootstrapTests {
	@Test("keeps server already running from bundled executable")
	func keepsBundledServer() {
		let bundled = URL(fileURLWithPath: "/Applications/Toby.app/Contents/Resources/toby")

		#expect(
			DaemonBootstrap.shouldReplaceServer(
				runningExecutablePath: "/Applications/Toby.app/Contents/Resources/toby",
				runningVersion: "1.2.3",
				bundledExecutable: bundled,
				bundledVersion: "1.2.3"
			) == false
		)
	}

	@Test("replaces bundled server running an older version")
	func replacesOlderBundledVersion() {
		let bundled = URL(fileURLWithPath: "/Applications/Toby.app/Contents/Resources/toby")

		#expect(
			DaemonBootstrap.shouldReplaceServer(
				runningExecutablePath: "/Applications/Toby.app/Contents/Resources/toby",
				runningVersion: "1.2.2",
				bundledExecutable: bundled,
				bundledVersion: "1.2.3"
			)
		)
	}

	@Test("replaces server running from a different executable")
	func replacesDifferentExecutable() {
		let bundled = URL(fileURLWithPath: "/Applications/Toby.app/Contents/Resources/toby")

		#expect(
			DaemonBootstrap.shouldReplaceServer(
				runningExecutablePath: "/Users/dev/toby/apps/cli/src/cli.ts",
				runningVersion: "1.2.3",
				bundledExecutable: bundled,
				bundledVersion: "1.2.3"
			)
		)
	}

	@Test("replaces server when executable path is missing")
	func replacesMissingExecutablePath() {
		let bundled = URL(fileURLWithPath: "/Applications/Toby.app/Contents/Resources/toby")

		#expect(
			DaemonBootstrap.shouldReplaceServer(
				runningExecutablePath: nil,
				runningVersion: nil,
				bundledExecutable: bundled,
				bundledVersion: "1.2.3"
			)
		)
	}
}
