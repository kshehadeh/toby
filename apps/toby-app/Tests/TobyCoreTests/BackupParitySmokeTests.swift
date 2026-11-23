import Foundation
import GRDB
import Testing
import TobyAI
@testable import TobyCore
@testable import TobyStore

/// Opt-in: `TOBY_BACKUP_PARITY=<snapshot.tbybak> TOBY_BACKUP_PASSWORD=…` stages a real daemon snapshot
/// into a scratch home (the source file is only read) and imports it.
@Suite("Backup parity (opt-in)")
struct BackupParitySmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_BACKUP_PARITY"] != nil))
	func restoresARealSnapshot() throws {
		let source = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TOBY_BACKUP_PARITY"]!)
		let password = try #require(ProcessInfo.processInfo.environment["TOBY_BACKUP_PASSWORD"], "set TOBY_BACKUP_PASSWORD")
		let home = try temporaryHome()
		defer { try? FileManager.default.removeItem(at: home) }
		let paths = TobyPaths(root: home)
		let service = BackupService(paths: paths, writer: try TobyDatabase.inMemory().writer, secrets: InMemorySecretStore(), openRouter: nil, passphrase: { password })
		let staged = try service.restore(file: source, password: password, includeSettings: false)
		print("staged:", staged)
		let projects = try BackupService.applyPending(paths, secrets: InMemorySecretStore(), openRouter: nil)
		let database = try TobyDatabase.open(paths: paths)
		_ = try LegacyImporter(paths: paths, database: database, secrets: InMemorySecretStore(), openRouterKeyStore: nil).run(force: true)
		try BackupService.repointProjects(projects, writer: database.writer, projectsDir: paths.projects)
		let counts = try database.writer.read { db in
			try ["chat_sessions", "memory_items", "projects", "flows", "flow_runs", "todo_entities"].map { ($0, try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \($0)") ?? -1) }
		}
		print("counts:", counts, "projects:", projects.count,
		      "recordings:", (try? FileManager.default.contentsOfDirectory(atPath: paths.listenRecordings.path).count) ?? 0)
		#expect(staged.database)
	}
}
