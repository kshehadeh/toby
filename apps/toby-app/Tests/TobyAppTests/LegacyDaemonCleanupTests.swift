import Foundation
import Testing
import TobyStore
@testable import TobyApp

@Suite("Legacy daemon cleanup")
struct LegacyDaemonCleanupTests {
	@Test("removes daemon leftovers once, only after the import")
	func removesLeftoversOnce() throws {
		let root = FileManager.default.temporaryDirectory.appending(path: "toby-cleanup-\(UUID().uuidString)")
		defer { try? FileManager.default.removeItem(at: root) }
		let paths = TobyPaths(root: root)
		let fm = FileManager.default
		for dir in ["plugins/slack", "plugins-data/email", "helpers/bun", "app", "projects/p1"] {
			try fm.createDirectory(at: root.appending(path: dir), withIntermediateDirectories: true)
		}
		// Our own pid is not a Toby daemon, so it must never be signalled.
		try Data(#"{"pid":\#(ProcessInfo.processInfo.processIdentifier),"intervalSeconds":60}"#.utf8).write(to: root.appending(path: "daemon.lock"))
		try Data("7847".utf8).write(to: root.appending(path: "native-port"))

		LegacyDaemonCleanup.runOnce(paths, imported: false)
		#expect(fm.fileExists(atPath: root.appending(path: "plugins-data").path), "nothing removed before the import succeeds")

		LegacyDaemonCleanup.runOnce(paths, imported: true)
		for gone in ["plugins", "plugins-data", "helpers/bun", "daemon.lock", "native-port"] {
			#expect(!fm.fileExists(atPath: root.appending(path: gone).path), "\(gone) removed")
		}
		#expect(fm.fileExists(atPath: root.appending(path: "projects/p1").path), "user data kept")
		#expect(fm.fileExists(atPath: paths.appDirectory.appending(path: LegacyDaemonCleanup.marker).path))

		try fm.createDirectory(at: root.appending(path: "plugins"), withIntermediateDirectories: true)
		LegacyDaemonCleanup.runOnce(paths, imported: true)
		#expect(fm.fileExists(atPath: root.appending(path: "plugins").path), "runs only once")
		#expect(!LegacyDaemonCleanup.isTobyDaemon(Int(ProcessInfo.processInfo.processIdentifier)))
		#expect(LegacyDaemonCleanup.isDaemonCommand("/Applications/Toby.app/Contents/Resources/toby daemon run --interval 60"))
		#expect(LegacyDaemonCleanup.isDaemonCommand("/Users/me/.bun/bin/bun /Users/me/dev/toby/apps/cli/src/cli.ts daemon run --interval 60"))
		#expect(!LegacyDaemonCleanup.isDaemonCommand("swiftpm-testing-helper /Users/me/dev/toby/TobyAppTests.xctest --filter LegacyDaemonCleanup"))
		#expect(!LegacyDaemonCleanup.isDaemonCommand("bun run /Users/me/dist/toby-plugin-slack/src/cli.ts inbound run"))
	}
}
