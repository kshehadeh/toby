import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Opt-in: import a copied Toby home and dump native todo listings for diffing
/// against the daemon. Set TOBY_IMPORT_SMOKE_DIR and TOBY_PARITY_OUT.
@Suite("Todo parity smoke (opt-in)")
struct TodoParitySmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_PARITY_OUT"] != nil))
	func dumpsNativeListing() throws {
		let env = ProcessInfo.processInfo.environment
		let paths = TobyPaths(root: URL(fileURLWithPath: env["TOBY_IMPORT_SMOKE_DIR"]!))
		let database = try TobyDatabase.open(paths: paths)
		_ = try LegacyImporter(paths: paths, database: database, secrets: InMemorySecretStore(), openRouterKeyStore: nil).run(force: true)
		let service = TodoService(writer: database.writer, tobyDirectory: paths.root)
		let listing = try service.list(["status": "all", "limit": 200])
		try Data(listing.jsonString().utf8).write(to: URL(fileURLWithPath: env["TOBY_PARITY_OUT"]!))
	}
}
