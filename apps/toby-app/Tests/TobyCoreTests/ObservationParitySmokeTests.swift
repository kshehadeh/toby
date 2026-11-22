import Foundation
import GRDB
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Opt-in: recompute content hashes of imported observations; they must match
/// the daemon's so the native ledger doesn't re-ingest (and re-evaluate) them.
@Suite("Observation parity smoke (opt-in)")
struct ObservationParitySmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_OBS_PARITY_DIR"] != nil))
	func hashesMatchTheDaemon() async throws {
		let paths = TobyPaths(root: URL(fileURLWithPath: ProcessInfo.processInfo.environment["TOBY_OBS_PARITY_DIR"]!))
		let database = try TobyDatabase.open(paths: paths)
		_ = try LegacyImporter(paths: paths, database: database, secrets: InMemorySecretStore(), openRouterKeyStore: nil).run(force: true)
		let rows = try await database.writer.read { db in try Row.fetchAll(db, sql: "SELECT \(ObservationLedger.columns) FROM observations").map(Observation.init) }
		var bySource: [String: (match: Int, total: Int)] = [:]
		for o in rows {
			let input = ObservationInput(
				externalID: o.externalID, kind: o.kind, threadID: o.threadKey.map { String($0.dropFirst(o.sourceID.count + 1)) }, direction: o.direction,
				occurredAt: o.occurredAt, title: o.title, excerpt: o.excerpt, url: o.url, actors: o.actors, facts: o.facts,
			)
			var entry = bySource[o.sourceID] ?? (0, 0)
			entry.total += 1
			if ObservationLedger.contentHash(input) == o.contentHash { entry.match += 1 }
			bySource[o.sourceID] = entry
		}
		for (source, entry) in bySource.sorted(by: { $0.key < $1.key }) { print("OBSPARITY \(source): \(entry.match)/\(entry.total)") }
		let loops = try await database.writer.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM followup_loops") ?? 0 }
		print("OBSPARITY loops=\(loops)")
	}
}
