import Foundation
import Testing
@testable import TobyApp
import TobyAI
import TobyCore
import TobyStore

@MainActor struct NativeChatRouterTests {
	private func makeRouter(_ replies: [MockTransport.Reply]) throws -> (NativeChatRouter, URL) {
		let home = FileManager.default.temporaryDirectory.appending(path: "toby-chat-\(UUID().uuidString)", directoryHint: .isDirectory)
		try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
		let database = try TobyDatabase.inMemory()
		let transport = MockTransport(replies)
		let client = OpenRouterClient(keyProvider: StaticAPIKey("sk-or-test"), transport: transport)
		let projects = ProjectService(writer: database.writer, tobyDirectory: home)
		let personas = PersonaService(tobyDirectory: home)
		let toolbox = ChatToolbox(
			todos: TodoActions(service: TodoService(writer: database.writer, tobyDirectory: home)),
			memory: MemoryService(writer: database.writer), graph: GraphService(writer: database.writer),
			library: LibraryService(writer: database.writer, libraryDirectory: home.appending(path: "library")),
			projects: projects, skills: SkillService(root: home.appending(path: "skills")), tobyDirectory: home, ai: client, transport: transport,
		)
		let engine = ChatEngine(sessions: projects.sessions, toolbox: toolbox, personas: personas, ai: client)
		return (NativeChatRouter(engine: engine, sessions: projects.sessions, personas: personas, projects: projects), home)
	}

	@Test("native turns decode into the app's chat payloads and session detail")
	func decodesIntoAppModels() async throws {
		let (router, home) = try makeRouter([
			.json(200, ["data": []]),
			.sse([Chunks.toolCall(index: 0, id: "ask", name: "askUser", arguments: #"{"query":"Pick one","options":["A","B"]}"#)] + Chunks.finish("tool_calls")),
			.sse([Chunks.text("You picked B.")] + Chunks.finish("stop")),
			.sse([Chunks.text("Picking letters")] + Chunks.finish("stop")),
		])
		defer { try? FileManager.default.removeItem(at: home) }
		let created = try JSONDecoder().decode(CreateSessionResponse.self, from: try router.create(persona: "Mailman"))
		var events: [ChatEventPayload] = []
		var prompts: [AskUserPromptPayload] = []
		var done: TurnDonePayload?
		for await item in router.turn(sessionID: created.id, text: "Choose", attachments: [], turnID: "t1") {
			switch item {
			case let .event(data): events.append(try JSONDecoder().decode(ChatEventPayload.self, from: data))
			case let .askUser(turnID, requestID, query, options, reply):
				prompts.append(AskUserPromptPayload(turnId: turnID, requestId: requestID, query: query, options: options))
				reply(1, "B", "B")
			case let .done(data): done = try JSONDecoder().decode(TurnDonePayload.self, from: data)
			case let .failed(message): Issue.record("turn failed: \(message)")
			case let .outOfCredits(message): Issue.record("out of credits: \(message)")
			}
		}
		#expect(prompts.map(\.query) == ["Pick one"])
		#expect(prompts.first?.turnId == "t1")
		#expect(done?.text == "You picked B.")
		#expect(done?.sessionName == "Picking letters")
		#expect(events.first?.header == "Chatting with Mailman")
		#expect(events.contains { $0.type == "tool_call_complete" && $0.toolName == "askUser" })

		let detail = try JSONDecoder().decode(SessionDetail.self, from: try router.detail(created.id))
		#expect(detail.name == "Picking letters")
		#expect(detail.settings?.persona == "Mailman")
		#expect(detail.messageCount == 4)
		#expect(detail.personaImageUrl == "/api/personas/image/mailman.png")
		#expect(detail.transcript.contains { if case let .askUserQA(_, query, answer, _) = $0 { query == "Pick one" && answer == "B" } else { false } })
		#expect(detail.transcript.contains { if case let .boxedStep(step) = $0 { step.variant == "assistant" && step.body == "You picked B." } else { false } })

		struct Sessions: Decodable { let sessions: [SessionSummary] }
		#expect(try JSONDecoder().decode(Sessions.self, from: try router.list(limit: 10)).sessions.map(\.id) == [created.id])
	}
}
