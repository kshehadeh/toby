import Foundation
import Testing
@testable import TobyApp

@MainActor
@Suite("ChatTurnEngine")
struct ChatTurnEngineTests {
	private func makeState(
		transcript: [TranscriptEntry] = [],
		activityLine: String = "Ready",
	) -> ChatTurnMutationState {
		ChatTurnMutationState(
			transcript: transcript,
			streamingAssistant: nil,
			activityLine: activityLine,
			assistantHeader: "",
			assistantBuffer: "",
			sawToolCallThisTurn: false,
			personaFallback: "Assistant",
		)
	}

	private func event(from json: String) throws -> ChatEventPayload {
		try JSONDecoder().decode(ChatEventPayload.self, from: Data(json.utf8))
	}

	@Test("lifecycle_start appends processing row and updates activity line")
	func lifecycleStartAppendsProcessingRow() throws {
		var state = makeState()
		let event = try event(from: """
			{"type":"lifecycle_start","id":"life-1","header":"Working"}
			""")
		ChatTurnEngine.apply(event: event, state: &state)

		#expect(state.activityLine == "Working")
		#expect(state.transcript.count == 1)
		guard case .boxedStep(let payload) = state.transcript[0] else {
			Issue.record("expected boxedStep")
			return
		}
		#expect(payload.id == "life-1")
		#expect(payload.variant == "lifecycle")
		#expect(payload.header == "Working")
		#expect(payload.body == "Thinking")
	}

	@Test("assistant_text_delta accumulates streaming buffer")
	func assistantTextDeltaAccumulatesBuffer() throws {
		var state = makeState()
		let start = try event(from: """
			{"type":"assistant_segment_start","header":"Toby"}
			""")
		ChatTurnEngine.apply(event: start, state: &state)
		#expect(state.assistantHeader == "Toby")
		#expect(state.streamingAssistant?.text == "")
		#expect(state.activityLine == "Responding…")

		let delta1 = try event(from: """
			{"type":"assistant_text_delta","delta":"Hello"}
			""")
		ChatTurnEngine.apply(event: delta1, state: &state)
		let delta2 = try event(from: """
			{"type":"assistant_text_delta","delta":" world"}
			""")
		ChatTurnEngine.apply(event: delta2, state: &state)

		#expect(state.assistantBuffer == "Hello world")
		#expect(state.streamingAssistant?.text == "Hello world")
		#expect(state.streamingAssistant?.header == "Toby")
	}

	@Test("assistant_segment_end commits boxed assistant step")
	func assistantSegmentEndCommitsStep() throws {
		var state = makeState()
		state.assistantHeader = "Toby"
		state.assistantBuffer = "Final answer"
		state.streamingAssistant = StreamingAssistantState(
			header: "Toby",
			text: "Final answer",
			inWorkArea: true,
		)

		let end = try event(from: """
			{"type":"assistant_segment_end","id":"seg-1","interim":false}
			""")
		ChatTurnEngine.apply(event: end, state: &state)

		#expect(state.assistantBuffer.isEmpty)
		#expect(state.streamingAssistant == nil)
		#expect(state.transcript.count == 1)
		guard case .boxedStep(let payload) = state.transcript[0] else {
			Issue.record("expected boxedStep")
			return
		}
		#expect(payload.id == "seg-1")
		#expect(payload.variant == "assistant")
		#expect(payload.body == "Final answer")
		#expect(payload.header == "Toby")
	}

	@Test("transcript_notice appends notice entry")
	func transcriptNoticeAppendsNotice() throws {
		var state = makeState()
		let event = try event(from: """
			{"type":"transcript_notice","text":"  Skill selected  ","tone":"info"}
			""")
		ChatTurnEngine.apply(event: event, state: &state)
		#expect(state.transcript == [.notice(text: "Skill selected", tone: "info")])
	}

	@Test("hasAssistantReplyBody finds matching assistant boxed step")
	func hasAssistantReplyBodyFindsMatch() {
		let transcript: [TranscriptEntry] = [
			.user(text: "hi"),
			.boxedStep(
				BoxedStepPayload(
					id: "a1",
					seq: 2,
					variant: "assistant",
					header: "Toby",
					body: "Hello there",
					toolName: nil,
					integrationLabel: nil,
					cacheHit: nil,
					durationMs: nil,
					toolRuns: nil,
					fullBody: nil,
				),
			),
		]
		#expect(
			ChatTurnEngine.hasAssistantReplyBody("Hello there", sinceIndex: 0, in: transcript)
		)
		#expect(
			!ChatTurnEngine.hasAssistantReplyBody("Different", sinceIndex: 0, in: transcript)
		)
	}

	@Test("tool_call_start for askUser only updates activity line")
	func askUserToolStartDoesNotAppendToolRow() throws {
		var state = makeState()
		let event = try event(from: """
			{"type":"tool_call_start","toolName":"askUser"}
			""")
		ChatTurnEngine.apply(event: event, state: &state)
		#expect(state.transcript.isEmpty)
		#expect(state.sawToolCallThisTurn == false)
		#expect(state.activityLine == "Waiting for your choice…")
	}

	@Test("successful createLocalSkill posts skillsDidChange")
	func createLocalSkillPostsSkillsDidChange() throws {
		let expectation = expectationForNotification(.skillsDidChange)
		var state = makeState()
		let event = try event(from: """
			{"type":"tool_call_complete","toolName":"createLocalSkill","id":"t1","blockKey":"t1","result":{"ok":true}}
			""")
		ChatTurnEngine.apply(event: event, state: &state)
		#expect(expectation.wasPosted)
	}

	@Test("failed createLocalSkill does not post skillsDidChange")
	func failedCreateLocalSkillDoesNotPostSkillsDidChange() throws {
		let expectation = expectationForNotification(.skillsDidChange)
		var state = makeState()
		let event = try event(from: """
			{"type":"tool_call_complete","toolName":"createLocalSkill","id":"t1","blockKey":"t1","error":"disk full"}
			""")
		ChatTurnEngine.apply(event: event, state: &state)
		#expect(!expectation.wasPosted)
	}

	/// Records whether a named notification is posted during the current runloop turn.
	private final class NotificationExpectation: @unchecked Sendable {
		private(set) var wasPosted = false
		private var token: NSObjectProtocol?

		init(name: Notification.Name) {
			token = NotificationCenter.default.addObserver(
				forName: name,
				object: nil,
				queue: nil
			) { [weak self] _ in
				self?.wasPosted = true
			}
		}

		deinit {
			if let token {
				NotificationCenter.default.removeObserver(token)
			}
		}
	}

	private func expectationForNotification(_ name: Notification.Name) -> NotificationExpectation {
		NotificationExpectation(name: name)
	}
}
