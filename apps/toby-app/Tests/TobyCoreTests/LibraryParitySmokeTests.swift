import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Opt-in: dump the native library listing of an imported copy.
@Suite("Library parity smoke (opt-in)")
struct LibraryParitySmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_LIBRARY_PARITY_OUT"] != nil))
	func dumps() throws {
		let env = ProcessInfo.processInfo.environment
		let paths = TobyPaths(root: URL(fileURLWithPath: env["TOBY_IMPORT_SMOKE_DIR"]!))
		let database = try TobyDatabase.open(paths: paths)
		_ = try LegacyImporter(paths: paths, database: database, secrets: InMemorySecretStore(), openRouterKeyStore: nil).run(force: true)
		let listing = try LibraryService(writer: database.writer, libraryDirectory: paths.library).list(limit: 500)
		try Data(JSONValue.object(["items": .array(listing.items), "total": .number(Double(listing.total))]).jsonString().utf8)
			.write(to: URL(fileURLWithPath: env["TOBY_LIBRARY_PARITY_OUT"]!))
	}
}
