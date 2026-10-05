import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("Companion conversation-only transcript")
struct CompanionConversationTests {
	private func step(_ variant: String, body: String) -> TranscriptEntry {
		.boxedStep(BoxedStepPayload(id: variant, seq: 1, variant: variant, header: "Internal work",
			body: body, toolName: nil, integrationLabel: nil, cacheHit: nil,
			durationMs: nil, toolRuns: nil, fullBody: nil))
	}

	@Test("Skills, tools, preparation, and work cards never enter companion rendering")
	func hidesWorkDetails() throws {
		let store = CompanionStore()
		let question = TranscriptEntry.user(text: "Question")
		let answer = step("assistant", body: "Answer")
		store.chat.transcript = [
			question,
			.notice(text: "Skills: research", tone: nil),
			.notice(text: "2 tools: search, read", tone: nil),
			.notice(text: "2 TOOLS: search, read", tone: nil),
			.meta(text: "Internal metadata"),
			step("prep", body: "Selected skills"),
			step("lifecycle", body: "Preparing session"),
			step("thinking", body: "Internal reasoning"),
			step("plan", body: "Tool plan"),
			step("tool", body: "Raw tool result"),
			.toolCall(blockKey: "tool", title: "Search", toolName: "search"),
			.toolOutput(blockKey: "tool", detail: "Raw data", toolName: "search"),
			.turnWork(durationMs: 1000), answer,
		]
		#expect(store.conversationEntries == [question, answer])
		#expect(store.chat.transcript.count == 14) // Full saved chat remains intact.
		let view = CompanionBubbleView(store: store, close: {}, hide: {})
		let transcript = try view.inspect().find(TranscriptView.self).actualView()
		#expect(transcript.entries == [question, answer])
		let groups = TranscriptGrouping.groupedItems(from: transcript.entries, isLoading: true)
		#expect(groups.allSatisfy { if case .workGroup = $0 { return false }; return true })
	}

	@Test("Errors, cancelled turns, answered choices, and assistant segments stay visible")
	func preservesConversationFeedback() {
		let store = CompanionStore()
		let visible: [TranscriptEntry] = [
			.user(text: "Question"), step("assistant_interim", body: "Checking that"),
			.error(text: "Could not complete the request"),
			.askUserQA(blockKey: "ask", query: "Which one?", answer: "First", error: nil),
			.notice(text: "Turn cancelled.", tone: nil), .assistant(text: "Answer"),
		]
		store.chat.transcript = [visible[0], step("tool", body: "Raw result")] + Array(visible.dropFirst())
		#expect(store.conversationEntries == visible)
	}

	@Test("Progress labels hide tool names while preserving interactive question status")
	func quietProgress() {
		let store = CompanionStore()
		store.chat.isLoading = true
		store.chat.activityLine = "Running Search memory…"
		#expect(store.activityLabel == "Thinking…")
		store.chat.activeAskUserPrompt = ActiveAskUserPrompt(id: "ask", turnId: "turn", requestId: "ask", query: "Which one?", options: ["First"])
		#expect(store.activityLabel == "Waiting for your choice…")
	}
}
