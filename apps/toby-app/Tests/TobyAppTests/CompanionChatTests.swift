import Foundation
import Testing
@testable import TobyApp

@MainActor
@Suite("Companion live chat")
struct CompanionChatTests {
	private func client() -> MockChatClient {
		let client = MockChatClient()
		client.status = AppStatus(version: "1", persona: "Toby", model: "test", hasConfiguredAIProvider: true,
			tobyDir: nil, contextWindow: nil, personaImageUrl: nil, connectedIntegrations: nil,
			personaCount: nil, skillCount: nil, skills: nil, transcription: nil)
		client.createSessionResponse = CreateSessionResponse(id: "companion-chat", name: "New chat", settings: nil)
		client.turnDone = TurnDonePayload(turnId: nil, text: "Hello", appliedActions: nil, sessionName: nil, usage: nil, contextWindow: nil)
		return client
	}

	private func waitUntil(_ predicate: () -> Bool) async throws {
		for _ in 0..<1000 {
			if predicate() { return }
			try await Task.sleep(for: .milliseconds(1))
		}
		Issue.record("Timed out waiting for companion state")
	}

	@Test("Opening creates no session; sending creates one and follow-ups reuse it")
	func sessionLifecycle() async throws {
		let client = client()
		let store = CompanionStore(client: client)
		#expect(client.createSessionCalls == 0)
		store.draft = " \n "
		store.send()
		#expect(!store.isThinking)
		store.draft = " Hello Toby \n"
		store.send()
		store.send()
		#expect(store.isThinking)
		try await waitUntil { !store.isThinking }
		#expect(client.createSessionCalls == 1)
		#expect(client.streamTexts == ["Hello Toby"])
		#expect(store.chat.transcript.contains { if case .user(let text, _, _) = $0 { return text == "Hello Toby" }; return false })
		#expect(!store.chat.transcript.isEmpty)
		store.draft = "Follow-up"
		store.send()
		try await waitUntil { !store.isThinking }
		#expect(client.createSessionCalls == 1)
		#expect(client.streamSessionIds == ["companion-chat", "companion-chat"])
		#expect(client.streamTexts == ["Hello Toby", "Follow-up"])
		store.reset()
		#expect(store.chat.sessionId == nil && !store.hasConversation)
		#expect(client.deletedSessionIds.isEmpty)
	}

	@Test("Creation failures preserve the question and allow retry")
	func failedCreation() async throws {
		let client = client()
		client.createSessionResponse = nil
		let store = CompanionStore(client: client)
		store.draft = "My question"
		store.send()
		try await waitUntil { !store.isThinking }
		#expect(store.draft == "My question")
		#expect(store.errorMessage != nil)
		#expect(store.canSubmit)
		#expect(client.streamTurnCalls == 0)
		client.createSessionResponse = CreateSessionResponse(id: "retry", name: "New", settings: nil)
		store.send()
		try await waitUntil { !store.isThinking }
		#expect(store.errorMessage == nil && client.streamTurnCalls == 1)
	}

	@Test("Partial replies are visible while streaming; Stop cancels the daemon turn")
	func streamingAndStop() async throws {
		let client = client()
		client.waitForStream = true
		client.streamEvents = [try JSONDecoder().decode(ChatEventPayload.self, from: Data(#"{"type":"assistant_text_delta","delta":"Partial answer"}"#.utf8))]
		let store = CompanionStore(client: client)
		store.draft = "Question"
		store.send()
		try await waitUntil { client.streamGate != nil }
		#expect(store.chat.streamingAssistant?.text == "Partial answer")
		#expect(store.canStop)
		store.reset()
		#expect(store.isThinking) // A running turn cannot be orphaned by Start over.
		store.stop()
		try await waitUntil { !store.isThinking }
		#expect(client.cancelTurnCalls.count == 1)
		#expect(store.chat.transcript.contains(.notice(text: "Turn cancelled.", tone: nil)))
	}

	@Test("Stream errors remain visible in the transcript and allow another question")
	func failedTurn() async throws {
		let client = client()
		client.streamTurnError = TobyClientError.streamError("Model unavailable")
		let store = CompanionStore(client: client)
		store.draft = "Question"
		store.send()
		try await waitUntil { !store.isThinking }
		#expect(store.chat.transcript.contains(.error(text: "Model unavailable")))
		store.draft = "Try again"
		#expect(store.canSubmit)
	}

	@Test("Interactive tool questions accept the user's answer and resume the turn")
	func interactiveQuestion() async throws {
		let client = client()
		client.askUserPrompt = AskUserPromptPayload(turnId: "turn", requestId: "ask", query: "Which one?", options: ["First", "Second"])
		let store = CompanionStore(client: client)
		store.draft = "Question"
		store.send()
		try await waitUntil { store.chat.activeAskUserPrompt != nil }
		#expect(store.isThinking)
		store.chat.submitAskUserOption(index: 1)
		try await waitUntil { !store.isThinking }
		#expect(client.askUserAnswer == "Second")
		#expect(store.chat.activeAskUserPrompt == nil)
	}

	@Test("Home switch detaches old replies and clears the companion workspace")
	func homeSwitch() async throws {
		let client = client()
		client.waitForStream = true
		let store = CompanionStore(client: client)
		store.draft = "Question"
		store.send()
		try await waitUntil { client.streamGate != nil }
		store.resetForHomeSwitch()
		try await waitUntil { client.cancelTurnCalls.count == 1 }
		#expect(!store.isThinking && !store.hasConversation)
		#expect(store.chat.sessionId == nil)
	}
}
