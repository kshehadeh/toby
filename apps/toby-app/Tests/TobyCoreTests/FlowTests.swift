import Foundation
import GRDB
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Scripted macOS event source.
actor FakeFlowEvents: FlowEventSource {
	var pending: [JSONValue] = []
	private(set) var subscriptions: [[String]] = []
	private(set) var completions: [String] = []
	var sequence = 0

	func push(type: String, payload: JSONValue = [:], at: Date = Date()) {
		sequence += 1
		pending.append(["version": 1, "id": .string("s1:\(sequence)"), "source": "macos", "type": .string(type), "occurredAt": .string(TodoRecurrence.isoString(at)),
		                "observationSessionId": "s1", "sequence": .number(Double(sequence)), "payload": payload])
	}

	func subscribe(owner: String, types: [String], watches: [JSONValue]) async throws -> JSONValue {
		subscriptions.append(types)
		return ["sessionId": "s1", "sequence": .number(Double(sequence - pending.count)), "idleAvailable": true]
	}

	func events(session: String, after: Int, limit: Int) async throws -> JSONValue {
		let out = pending.filter { ($0["sequence"]?.intValue ?? 0) > after }
		pending.removeAll()
		return ["events": .array(out), "sequence": .number(Double(sequence))]
	}

	func notifyCompletion(flowID: String, runID: String?, name: String, success: Bool) async { completions.append("\(name):\(success)") }
}

@Suite("Cron")
struct CronTests {
	static let utc = TimeZone(identifier: "UTC")!
	static func date(_ iso: String) -> Date { TodoRecurrence.parseISO(iso)! }

	@Test func parsesFieldsAndFindsOccurrences() throws {
		let weekdays = try #require(CronExpression("30 8 * * 1-5"))
		#expect(weekdays.previous(before: Self.date("2026-11-22T10:00:00.000Z"), timezone: Self.utc) == Self.date("2026-11-20T08:30:00.000Z"), "Sunday → Friday")
		#expect(weekdays.next(after: Self.date("2026-11-20T08:30:00.000Z"), timezone: Self.utc) == Self.date("2026-11-23T08:30:00.000Z"))
		let every15 = try #require(CronExpression("*/15 * * * *"))
		#expect(every15.previous(before: Self.date("2026-11-22T10:44:59.000Z"), timezone: Self.utc) == Self.date("2026-11-22T10:30:00.000Z"))
		let orSemantics = try #require(CronExpression("0 9 1 * MON"))
		#expect(orSemantics.previous(before: Self.date("2026-11-22T12:00:00.000Z"), timezone: Self.utc) == Self.date("2026-11-16T09:00:00.000Z"), "Monday or the 1st")
		let sundaySeven = try #require(CronExpression("0 0 * * 7"))
		#expect(sundaySeven.previous(before: Self.date("2026-11-22T12:00:00.000Z"), timezone: Self.utc) == Self.date("2026-11-22T00:00:00.000Z"))
		let ny = TimeZone(identifier: "America/New_York")!
		#expect(CronExpression("0 9 * * *")!.previous(before: Self.date("2026-11-22T15:00:00.000Z"), timezone: ny) == Self.date("2026-11-22T14:00:00.000Z"))
		for bad in ["", "* * *", "61 * * * *", "* * * * 9", "a b c d e", "*/0 * * * *"] { #expect(CronExpression(bad) == nil, "\(bad)") }
	}

	@Test func plainLanguagePatterns() {
		#expect(CronLanguage.pattern("every weekday at 8:30am") == "30 8 * * 1-5")
		#expect(CronLanguage.pattern("Every day at 5 pm") == "0 17 * * *")
		#expect(CronLanguage.pattern("every 15 minutes") == "*/15 * * * *")
		#expect(CronLanguage.pattern("every 2 hours") == "0 */2 * * *")
		#expect(CronLanguage.pattern("weekly") == "0 9 * * 1")
		#expect(CronLanguage.pattern("0 7 * * *") == "0 7 * * *")
		#expect(CronLanguage.pattern("twice a day around lunch") == nil)
	}
}

@Suite("Flows")
struct FlowTests {
	let home: URL
	let database: TobyDatabase
	let transport: MockTransport
	let todos: TodoService
	let runner: FlowRunner

	init(_ replies: [MockTransport.Reply] = []) throws {
		home = try temporaryHome()
		database = try TobyDatabase.inMemory()
		transport = MockTransport(replies)
		let client = OpenRouterClient(keyProvider: StaticAPIKey("sk-or-test"), transport: transport)
		todos = TodoService(writer: database.writer, tobyDirectory: home)
		let toolbox = ChatToolbox(
			todos: TodoActions(service: todos), memory: MemoryService(writer: database.writer), graph: GraphService(writer: database.writer),
			library: LibraryService(writer: database.writer, libraryDirectory: home.appending(path: "library")), projects: ProjectService(writer: database.writer, tobyDirectory: home),
			skills: SkillService(root: home.appending(path: "skills")), tobyDirectory: home, ai: client, transport: transport,
		)
		runner = FlowRunner(writer: database.writer, tools: FlowTools(toolbox: toolbox), personas: PersonaService(tobyDirectory: home),
		                    skills: SkillService(root: home.appending(path: "skills")), ai: client, mail: nil, slack: nil)
	}

	static func completion(_ content: String) -> MockTransport.Reply {
		.json(200, ["choices": [["message": ["role": "assistant", "content": .string(content)]]], "usage": ["prompt_tokens": 5, "completion_tokens": 2]])
	}

	static let todoFlow: JSONValue = [
		"name": "Plan my day", "icon": "sparkles",
		"triggers": [["id": "manual", "name": "Manually", "enabled": true, "source": ["type": "manual"]],
		             ["id": "morning", "name": "Mornings", "enabled": true, "source": ["type": "schedule", "cron": "0 7 * * *"], "conditions": ["timezone": "UTC"]]],
		"nodes": [
			["id": "decide", "type": "llm_prompter", "schema": ["kind": "object", "fields": ["title": ["type": "string"], "urgent": ["type": "boolean"]]],
			 "systemPrompt": "Pick one task for {{inputs.who}}.", "userPrompt": "Context: {{bag.note}}", "inputs": ["who": ["const": "Ana"]], "outputs": ["choice": "object"]],
			["id": "add", "type": "tool_executor", "tool": ["coreTool": "todos.create"], "when": ["from": "choice", "path": "urgent"],
			 "inputs": ["title": ["from": "choice", "path": "title"]]],
		],
	]

	@Test func validatesAndStoresDocuments() async throws {
		let flows = FlowService(writer: database.writer, runner: runner, events: nil, ai: runner.ai)
		let created = try await flows.save(Self.todoFlow, id: nil)
		let id = try #require(created["flow"]?["id"]?.stringValue)
		#expect(id.hasPrefix("flow."))
		#expect(created["document"]?["revision"] == 1)
		#expect(created["document"]?["destinations"] == [["type": "modal"]])
		#expect(created["flow"]?["nodes"]?[1]?["display"]?["title"] == "Create todo")
		#expect(created["document"]?["triggers"]?[1]?["policy"]?["cooldownSeconds"] == 300)
		var bad = Self.todoFlow.objectValue!
		bad["nodes"] = [["id": "x", "type": "tool_executor", "tool": ["coreTool": "todos.create"], "inputs": ["title": ["from": "nowhere"]]]]
		bad["color"] = "chartreuse"
		await #expect(throws: FlowValidationError.self) { try await flows.save(.object(bad), id: nil) }
		do { _ = try await flows.save(.object(bad), id: nil) } catch let error as FlowValidationError {
			#expect(error.issues.contains("Color \"chartreuse\" is not a supported flow color"))
			#expect(error.issues.contains("Node \"x\" input \"title\" must be a constant, a trigger context reference, or a previous step output"))
		}
		var stale = Self.todoFlow.objectValue!
		stale["revision"] = 7
		await #expect(throws: FlowValidationError.self) { try await flows.save(.object(stale), id: id) }
		#expect(try await flows.list()["flows"]?.arrayValue?.count == 1)
		#expect(try await flows.catalog()["modules"]?[0]?["tools"]?.arrayValue?.contains { $0["coreTool"] == "todos.create" } == true)
	}

	@Test func runsStepsRecordsHistoryAndExtractsTheResult() async throws {
		let test = try FlowTests([Self.completion(#"{"title":"Call the bank","urgent":true}"#)])
		let flows = FlowService(writer: test.database.writer, runner: test.runner, events: nil, ai: test.runner.ai)
		let id = try #require(try await flows.save(Self.todoFlow, id: nil)["flow"]?["id"]?.stringValue)
		let outcome = try await flows.runNow(id, source: "manual", triggerID: nil)
		#expect(outcome.json["ok"] == true, "\(outcome.json)")
		#expect(outcome.json["result"]?["text"] == "Create todo", "applied actions become the result")
		let titles = (try test.todos.list(["status": "open"])["todos"]?.arrayValue ?? []).compactMap { $0["title"]?.stringValue }
		#expect(titles == ["Call the bank"])
		let body = try #require(test.transport.requestBodies.first)
		#expect(body["messages"]?[0]?["content"]?.stringValue?.contains("Pick one task for Ana.") == true)
		let runID = try #require(outcome.json["runId"]?.stringValue)
		let detail = try #require(try await flows.runDetail(runID))
		#expect(detail["run"]?["status"] == "success")
		#expect(detail["run"]?["trigger"] == "manual:manual")
		#expect(detail["run"]?["nodes"]?.arrayValue?.map { $0["status"] ?? "" } == ["success", "success"])
		#expect(try await flows.runs(flowName: id, limit: 10, offset: 0)["runs"]?.arrayValue?.count == 1)
		await #expect(throws: TodoError.self) { try await flows.runNow(id, source: "home.action", triggerID: nil) }
	}

	@Test func falseConditionsSkipAndFailuresStopTheRun() async throws {
		let test = try FlowTests([Self.completion(#"{"title":"Nothing","urgent":false}"#), Self.completion(#"{"title":"x","urgent":"maybe"}"#), Self.completion(#"{"title":"x","urgent":"maybe"}"#)])
		let document = try FlowDocuments.validate(try FlowDocuments.parse(Self.todoFlow, id: "flow.t"), tools: test.runner.tools.catalog().tools, connected: [])
		let skipped = await test.runner.run(document)
		#expect(skipped.ok)
		#expect(skipped.extracted?["text"] == "Action skipped because its condition was false.")
		let failed = await test.runner.run(document)
		#expect(!failed.ok)
		#expect(failed.failedNodeID == "decide")
		#expect(try test.todos.list(["status": "open"])["todos"]?.arrayValue?.isEmpty == true)
	}

	@Test func markdownStepsAndTemplates() async throws {
		let test = try FlowTests([.sse([Chunks.text("## Today\n- Ship it")] + Chunks.finish("stop"))])
		let doc: [String: JSONValue] = [
			"id": "flow.md", "name": "Brief", "nodes": [["id": "write", "type": "llm_prompter", "schema": ["kind": "markdown"], "systemPrompt": "Brief.", "userPrompt": "Items:\n{{dashboardItems bag.feed}}",
			                                         "promptHelpers": ["appendCurrentDateTime": true]]],
		]
		let result = await test.runner.run(doc, options: .init(inputs: ["feed": ["items": [["title": "Pay rent", "subtitle": "Bills", "urgency": "high"]]]]))
		#expect(result.ok)
		#expect(result.extracted?["format"] == "markdown")
		#expect(result.extracted?["text"] == "## Today\n- Ship it")
		let body = try #require(test.transport.requestBodies.first)
		let user = body["messages"]?.arrayValue?.last?["content"]?.stringValue ?? ""
		#expect(user.contains("1. Pay rent\n   Bills\n   urgency: high"))
		#expect(body["messages"]?[0]?["content"]?.stringValue?.contains("local timezone") == true)
	}

	@Test func schedulesAndMacOSEventsEnqueueWithPolicies() async throws {
		let events = FakeFlowEvents()
		let flows = FlowService(writer: database.writer, runner: runner, events: events, ai: runner.ai)
		var doc = Self.todoFlow.objectValue!
		doc["triggers"] = [
			["id": "wake", "name": "On wake", "enabled": true, "source": ["type": "macos.didWake"], "conditions": ["timezone": "UTC"], "policy": ["cooldownSeconds": 3600]],
			["id": "morning", "name": "Mornings", "enabled": true, "source": ["type": "schedule", "cron": "* * * * *", "missedRuns": "skip"], "conditions": ["timezone": "UTC"], "policy": ["cooldownSeconds": 0]],
		]
		doc["nodes"] = [["id": "a", "type": "tool_executor", "tool": ["coreTool": "todos.summary"]]]
		let id = try #require(try await flows.save(.object(doc), id: nil)["flow"]?["id"]?.stringValue)
		try await database.writer.write { db in try db.execute(sql: "UPDATE flows SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", arguments: [id]) }
		await events.push(type: "macos.didWake")
		await events.push(type: "macos.didWake")
		try await flows.pollNativeEvents()
		try await database.writer.write { db in try FlowService.enqueueSchedules(db) }
		try await database.writer.write { db in try FlowService.enqueueSchedules(db) }
		let decisions = try await flows.decisions(flowID: id)["decisions"]?.arrayValue ?? []
		let summary = decisions.map { "\($0["event"]?["type"]?.stringValue ?? ""):\($0["status"]?.stringValue ?? ""):\($0["reason"]?.stringValue ?? "")" }.sorted()
		#expect(summary == ["macos.didWake:pending:", "macos.didWake:skipped:cooldown", "schedule:pending:"], "\(summary) \(decisions.map { $0["event"] ?? "" })")
		#expect(await events.subscriptions.last == ["macos.didWake"])
		let claimed = try await database.writer.write { db in try FlowService.claim(db, now: Date()) }
		#expect(claimed != nil)
		let second = try await database.writer.write { db in try FlowService.claim(db, now: Date()) }
		#expect(second == nil, "one running decision per flow")
	}
}
