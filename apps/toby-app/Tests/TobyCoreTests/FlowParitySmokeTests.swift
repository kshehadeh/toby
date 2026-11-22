import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Opt-in: dump imported flow run history for comparison with the daemon.
@Suite("Flow parity smoke (opt-in)")
struct FlowParitySmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_FLOW_PARITY_DIR"] != nil))
	func dumpsRuns() async throws {
		let paths = TobyPaths(root: URL(fileURLWithPath: ProcessInfo.processInfo.environment["TOBY_FLOW_PARITY_DIR"]!))
		let database = try TobyDatabase.open(paths: paths)
		_ = try LegacyImporter(paths: paths, database: database, secrets: InMemorySecretStore(), openRouterKeyStore: nil).run(force: true)
		let client = OpenRouterClient(keyProvider: StaticAPIKey("unused"))
		let todos = TodoService(writer: database.writer, tobyDirectory: paths.root)
		let toolbox = ChatToolbox(todos: TodoActions(service: todos), memory: MemoryService(writer: database.writer), graph: GraphService(writer: database.writer),
		                          library: LibraryService(writer: database.writer, libraryDirectory: paths.library), projects: ProjectService(writer: database.writer, tobyDirectory: paths.root),
		                          skills: SkillService(root: paths.skills), tobyDirectory: paths.root, ai: client)
		let runner = FlowRunner(writer: database.writer, tools: FlowTools(toolbox: toolbox), personas: PersonaService(tobyDirectory: paths.root), skills: SkillService(root: paths.skills), ai: client, mail: nil, slack: nil)
		let runs = try runner.runs(flowName: nil, limit: 50, offset: 0)
		let detail = try runs.first?["id"]?.stringValue.flatMap { try runner.run(id: $0) } ?? .null
		try Data(JSONValue.object(["runs": .array(runs), "detail": detail]).jsonString().utf8).write(to: paths.root.appending(path: "n-flows.json"))
	}
}
