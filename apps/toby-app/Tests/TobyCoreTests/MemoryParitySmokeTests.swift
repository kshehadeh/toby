import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Opt-in: dump native memory list + graph snapshot of an imported copy
/// (TOBY_IMPORT_SMOKE_DIR, TOBY_PARITY_DIR) for diffing against the daemon.
@Suite("Memory parity smoke (opt-in)")
struct MemoryParitySmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_PARITY_DIR"] != nil))
	func dumps() throws {
		let env = ProcessInfo.processInfo.environment
		let paths = TobyPaths(root: URL(fileURLWithPath: env["TOBY_IMPORT_SMOKE_DIR"]!))
		let database = try TobyDatabase.open(paths: paths)
		_ = try LegacyImporter(paths: paths, database: database, secrets: InMemorySecretStore(), openRouterKeyStore: nil).run(force: true)
		let out = URL(fileURLWithPath: env["TOBY_PARITY_DIR"]!)
		let memories = try MemoryService(writer: database.writer).list(limit: 500)
		try Data(JSONValue.object(["memories": .array(memories.items), "total": .number(Double(memories.total))]).jsonString().utf8).write(to: out.appending(path: "n-mem.json"))
		try Data(try GraphService(writer: database.writer).snapshot(types: nil, limit: 200).jsonString().utf8).write(to: out.appending(path: "n-graph.json"))
	}
}
