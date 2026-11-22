import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

final class EventLog: @unchecked Sendable {
	private let lock = NSLock()
	private var stored: [JSONValue] = []
	var events: [JSONValue] { lock.withLock { stored } }
	func append(_ event: JSONValue) { lock.withLock { stored.append(event) } }
	var types: [String] { events.compactMap { $0["type"]?.stringValue } }
}

final class ChatFixture {
	let home: URL
	let database: TobyDatabase
	let transport: MockTransport
	let engine: ChatEngine
	let sessions: ChatSessionStore
	let todos: TodoService

	init(_ replies: [MockTransport.Reply]) throws {
		home = try temporaryHome()
		database = try TobyDatabase.inMemory()
		transport = MockTransport(replies)
		let client = OpenRouterClient(keyProvider: StaticAPIKey("sk-or-test"), transport: transport)
		todos = TodoService(writer: database.writer, tobyDirectory: home)
		sessions = ChatSessionStore(writer: database.writer)
		let toolbox = ChatToolbox(
			todos: TodoActions(service: todos),
			memory: MemoryService(writer: database.writer),
			graph: GraphService(writer: database.writer),
			library: LibraryService(writer: database.writer, libraryDirectory: home.appending(path: "library")),
			projects: ProjectService(writer: database.writer, tobyDirectory: home),
			skills: SkillService(root: home.appending(path: "skills")),
			tobyDirectory: home,
			ai: client,
			transport: transport,
		)
		engine = ChatEngine(sessions: sessions, toolbox: toolbox, personas: PersonaService(tobyDirectory: home), ai: client)
	}

	deinit { try? FileManager.default.removeItem(at: home) }

	static let models: MockTransport.Reply = .json(200, ["data": [[
		"id": .string(ModelDefaults.chat), "name": "GPT", "context_length": 400_000, "supported_parameters": ["tools"],
	]]])

	static func title(_ text: String) -> MockTransport.Reply { .sse([Chunks.text(text)] + Chunks.finish("stop")) }
}

@Suite("Chat engine")
struct ChatEngineTests {
	@Test func runsAToolTurnPersistsAndNamesTheSession() async throws {
		let f = try ChatFixture([
			ChatFixture.models,
			.sse([Chunks.toolCall(index: 0, id: "call_1", name: "createTobyTodo", arguments: #"{"title":"Buy milk","description":null}"#)] + Chunks.finish("tool_calls", prompt: 1200, completion: 30)),
			.sse([Chunks.text("Added "), Chunks.text("**Buy milk**.")] + Chunks.finish("stop", prompt: 1300, completion: 8)),
			ChatFixture.title("Grocery reminder"),
		])
		let session = try f.sessions.create(name: nil)
		let id = try #require(session["id"]?.stringValue)
		let log = EventLog()
		let done = try await f.engine.runTurn(sessionID: id, text: "Remind me to buy milk", turnID: "turn-1", onEvent: { log.append($0) }) { _, _, _ in
			Issue.record("askUser not expected")
			return (0, "", "")
		}

		#expect(done["turnId"] == "turn-1")
		#expect(done["text"] == "Added **Buy milk**.")
		#expect(done["appliedActions"] == ["Create todo"])
		#expect(done["sessionName"] == "Grocery reminder")
		#expect(done["usage"]?["inputTokens"] == 2500)
		#expect(done["contextWindow"]?["supported"] == true)
		#expect(done["contextWindow"]?["contextWindowTokens"] == 400_000)

		let types = log.types
		#expect(types.first == "lifecycle_start")
		#expect(types.contains("tool_call_start") && types.contains("tool_call_complete"))
		#expect(types.filter { $0 == "assistant_text_delta" }.count == 2)
		#expect(log.events.first?["header"] == "Chatting with Toby")
		let seqs = log.events.compactMap { $0["seq"]?.intValue }
		#expect(seqs == Array(1 ... seqs.count))

		// The tool really ran.
		#expect(try f.todos.list()["todos"]?[0]?["title"] == "Buy milk")

		// Persistence: messages + transcript round-trip.
		let loaded = try #require(try f.sessions.load(id))
		#expect(loaded.name == "Grocery reminder")
		#expect(loaded.messages.map(\.role) == [.user, .assistant, .tool, .assistant])
		#expect(loaded.messages[1].toolCalls.first?.name == "createTobyTodo")
		let kinds = loaded.transcript.compactMap { $0["kind"]?.stringValue }
		#expect(kinds == ["user", "boxed_step", "boxed_step", "boxed_step", "turn_work"])
		let tool = loaded.transcript[2]
		#expect(tool["variant"] == "tool")
		#expect(tool["header"] == "Create todo")
		#expect(tool["failed"] == false)
		#expect(loaded.transcript[3]["variant"] == "assistant")
		#expect(loaded.transcript[3]["body"] == "Added **Buy milk**.")

		// The first request carried the system prompt, the date section, and every tool.
		let first = try #require(f.transport.requestBodies.dropFirst().first)
		let messages = try #require(first["messages"]?.arrayValue)
		#expect(messages[0]["content"]?.stringValue?.contains("You are Toby") == true)
		#expect(messages[1]["content"]?.stringValue?.contains("Current date and time") == true)
		#expect((first["tools"]?.arrayValue?.count ?? 0) > 30)
	}

	@Test func askUserRoundTripsThroughTheCallback() async throws {
		let f = try ChatFixture([
			ChatFixture.models,
			.sse([Chunks.toolCall(index: 0, id: "ask_1", name: "askUser", arguments: #"{"query":"Which list?","options":["Inbox","Work"]}"#)] + Chunks.finish("tool_calls")),
			.sse([Chunks.text("Using Work.")] + Chunks.finish("stop")),
		])
		let id = try #require(try f.sessions.create(name: "Existing")["id"]?.stringValue)
		let done = try await f.engine.runTurn(sessionID: id, text: "Add it", onEvent: { _ in }) { _, query, options in
			#expect(query == "Which list?")
			#expect(options == ["Inbox", "Work"])
			return (1, "Work", "Work")
		}
		#expect(done["sessionName"] == .null)
		let loaded = try #require(try f.sessions.load(id))
		let qa = try #require(loaded.transcript.first { $0["kind"] == "ask_user_qa" })
		#expect(qa["answer"] == "Work")
		#expect(qa["query"] == "Which list?")
		let toolMessage = try #require(loaded.messages.first { $0.role == .tool })
		#expect(toolMessage.text.contains("\"selectedLabel\":\"Work\""))
	}

	@Test func providerErrorsAreRecordedAndRethrown() async throws {
		let f = try ChatFixture([ChatFixture.models, .status(402, #"{"error":{"message":"Out of credits"}}"#)])
		let id = try #require(try f.sessions.create(name: "x")["id"]?.stringValue)
		await #expect(throws: AIError.insufficientCredits(message: "Out of credits")) {
			try await f.engine.runTurn(sessionID: id, text: "hi", onEvent: { _ in }) { _, _, _ in (0, "", "") }
		}
		let loaded = try #require(try f.sessions.load(id))
		#expect(loaded.transcript.map { $0["kind"]?.stringValue } == ["user", "boxed_step", "error"])
		#expect(loaded.messages.map(\.role) == [.user])
	}

	@Test func historyCompactionKeepsWholeExchanges() {
		let messages: [Message] = [
			.user(String(repeating: "a", count: 4000)), .assistant("ok"),
			.user("second"), .assistant("", toolCalls: [ToolCall(id: "c", name: "x", arguments: "{}")]),
			.tool(callId: "c", name: "x", result: "r"), .assistant("done"),
		]
		let kept = ChatEngine.compact(messages, contextTokens: 1000)
		#expect(kept.first?.role == .user)
		#expect(kept.first?.text == "second")
		#expect(kept.count == 4)
	}

	@Test func transcriptRowsRoundTrip() {
		let entries: [JSONValue] = [
			["kind": "user", "text": "plain"],
			["kind": "user", "text": "with time", "createdAt": "2027-01-01T00:00:00Z"],
			["kind": "boxed_step", "id": "a", "seq": 1, "variant": "tool", "header": "Create todo", "body": "Done.", "failed": false],
			["kind": "notice", "text": "Stopped.", "tone": "info"],
			["kind": "turn_work", "durationMs": 1200],
		]
		for entry in entries {
			let row = ChatTranscript.row(entry)
			#expect(ChatTranscript.entry(kind: row.kind, text: row.text) == entry)
		}
		#expect(ChatTranscript.row(entries[0]).text == "plain")
	}

	@Test func groupsRepeatedToolCallsIntoOneStep() {
		var reducer = ChatTranscript.Reducer(titles: ["getTobyTodo": "Get todo"])
		for key in ["a", "b"] {
			reducer.apply(["type": "tool_call_start", "blockKey": .string(key), "toolName": "getTobyTodo", "args": ["id": .string("todo-\(key)")], "seq": 1])
			reducer.apply(["type": "tool_call_complete", "blockKey": .string(key), "toolName": "getTobyTodo", "args": ["id": .string("todo-\(key)")], "result": ["ok": true, "result": ["title": "X"]], "seq": 2])
		}
		#expect(reducer.entries.count == 1)
		#expect(reducer.entries[0]["header"] == "Get todo (x2)")
		#expect(reducer.entries[0]["toolRuns"]?.arrayValue?.map { $0["body"]?.stringValue } == ["X", "X"])
	}
}
