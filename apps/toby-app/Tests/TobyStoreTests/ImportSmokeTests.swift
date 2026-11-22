import Foundation
import Testing
@testable import TobyStore

/// Opt-in: imports a *copy* of a real Toby home. Set TOBY_IMPORT_SMOKE_DIR.
/// Secrets go to memory only; only their names are printed.
@Suite("Import smoke (opt-in)")
struct ImportSmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_IMPORT_SMOKE_DIR"] != nil))
	func importsCopiedHome() throws {
		let root = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TOBY_IMPORT_SMOKE_DIR"]!)
		let paths = TobyPaths(root: root)
		let database = try TobyDatabase.open(paths: paths)
		let secrets = InMemorySecretStore()
		let importer = LegacyImporter(paths: paths, database: database, secrets: secrets, openRouterKeyStore: { _ in })
		let report = try importer.run(force: true)
		for (table, rows) in report.rowsByTable.sorted(by: { $0.key < $1.key }) {
			print("IMPORT \(table): \(rows)")
		}
		print("IMPORT messagesConverted: \(report.messagesConverted)")
		print("IMPORT openRouterKey: \(report.importedOpenRouterKey)")
		print("IMPORT secrets: \(secrets.all.keys.sorted())")
		print("IMPORT warnings: \(report.warnings)")
		print("IMPORT orphans: \(report.orphansDropped)")
		#expect(report.warnings.isEmpty)
	}
}
