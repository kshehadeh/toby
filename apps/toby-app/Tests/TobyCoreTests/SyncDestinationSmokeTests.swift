import Foundation
import GRDB
import Testing
@testable import TobyCore

/// Opt-in (TOBY_DESTINATION_HOME): the Swift vault root must hash to the
/// destination the daemon recorded, or every operation would be re-published.
@Suite("Sync destination parity (opt-in)")
struct SyncDestinationSmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_DESTINATION_HOME"] != nil))
	func matchesRecordedDestination() throws {
		let home = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TOBY_DESTINATION_HOME"]!)
		let settings = TodoSyncSettings.read(tobyDirectory: home)
		let root = settings.vaultRoot(environment: [:])
		var configuration = Configuration()
		configuration.readonly = true
		let device = try DatabaseQueue(path: home.appending(path: "todo-device.sqlite").path, configuration: configuration)
		let recorded = try device.read { db in try String.fetchOne(db, sql: "SELECT value FROM state WHERE key = 'destination'") }
		print("DESTINATION backend=\(settings.backend) match=\(TodoSync.destination(for: FileTodoBatchStore(rootDirectory: root)) == recorded)")
		#expect(TodoSync.destination(for: FileTodoBatchStore(rootDirectory: root)) == recorded)
	}
}
