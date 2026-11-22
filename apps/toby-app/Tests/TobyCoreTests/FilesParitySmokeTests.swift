import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Opt-in: dump native personas/skills/projects for an imported copy.
@Suite("Files parity smoke (opt-in)")
struct FilesParitySmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_FILES_PARITY_DIR"] != nil))
	func dumps() throws {
		let env = ProcessInfo.processInfo.environment
		let paths = TobyPaths(root: URL(fileURLWithPath: env["TOBY_IMPORT_SMOKE_DIR"]!))
		let database = try TobyDatabase.open(paths: paths)
		_ = try LegacyImporter(paths: paths, database: database, secrets: InMemorySecretStore(), openRouterKeyStore: nil).run(force: true)
		let out = URL(fileURLWithPath: env["TOBY_FILES_PARITY_DIR"]!)
		try Data(PersonaService(tobyDirectory: paths.root).listJSON().jsonString().utf8).write(to: out.appending(path: "n-personas.json"))
		try Data(SkillService(root: paths.skills).listJSON().jsonString().utf8).write(to: out.appending(path: "n-skills.json"))
		let projects = try ProjectService(writer: database.writer, tobyDirectory: paths.root).list().map(\.json)
		try Data(JSONValue.object(["projects": .array(projects)]).jsonString().utf8).write(to: out.appending(path: "n-projects.json"))
	}
}
