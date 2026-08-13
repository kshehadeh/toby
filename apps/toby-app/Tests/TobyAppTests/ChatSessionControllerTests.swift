import Foundation
import Testing
@testable import TobyApp

@Suite("ChatSessionController")
struct ChatSessionControllerTests {
	private func makeState(
		sessionId: String? = "s1",
		sessionName: String = "Old",
		transcript: [TranscriptEntry] = [.user(text: "hi")],
	) -> ChatSessionIdentityState {
		ChatSessionIdentityState(
			sessionId: sessionId,
			sessionName: sessionName,
			transcript: transcript,
			integration: "slack",
			integrationIconUrl: "/icons/slack.png",
			externalKey: "ext-1",
			sessionPersonaImageUrl: "/p.png",
			streamingAssistant: StreamingAssistantState(header: "T", text: "x", inWorkArea: false),
			turnWorkDurations: [0: 1.5],
			contextWindow: ContextWindowPayload(
				supported: true,
				contextWindowTokens: 100,
				fillPercentage: 10,
				unavailableReason: nil,
			),
			promptText: "draft",
			activityLine: "Busy",
		)
	}

	private func makeDetail(
		id: String = "s2",
		name: String = "New session",
		transcript: [TranscriptEntry] = [.user(text: "there")],
	) -> SessionDetail {
		SessionDetail(
			id: id,
			name: name,
			transcript: transcript,
			messageCount: transcript.count,
			settings: nil,
			contextWindow: ContextWindowPayload(
				supported: true,
				contextWindowTokens: 200,
				fillPercentage: 20,
				unavailableReason: nil,
			),
			personaImageUrl: "/new.png",
			activePlan: nil,
			integration: nil,
			integrationIconUrl: nil,
			externalKey: nil,
		)
	}

	@Test("shouldSelectSession skips when loading")
	func shouldSelectSessionSkipsWhenLoading() {
		#expect(
			!ChatSessionController.shouldSelectSession(
				requestedId: "s2",
				currentSessionId: "s1",
				transcriptIsEmpty: false,
				isLoading: true,
			)
		)
	}

	@Test("shouldSelectSession skips when already showing that session with content")
	func shouldSelectSessionSkipsSameSessionWithContent() {
		#expect(
			!ChatSessionController.shouldSelectSession(
				requestedId: "s1",
				currentSessionId: "s1",
				transcriptIsEmpty: false,
				isLoading: false,
			)
		)
	}

	@Test("shouldSelectSession allows reselect when transcript empty")
	func shouldSelectSessionAllowsEmptyTranscript() {
		#expect(
			ChatSessionController.shouldSelectSession(
				requestedId: "s1",
				currentSessionId: "s1",
				transcriptIsEmpty: true,
				isLoading: false,
			)
		)
	}

	@Test("applyLoadedSession replaces identity fields")
	func applyLoadedSessionReplacesFields() {
		var state = makeState()
		let detail = makeDetail()
		ChatSessionController.applyLoadedSession(detail, into: &state)

		#expect(state.sessionId == "s2")
		#expect(state.sessionName == "New session")
		#expect(state.transcript == [.user(text: "there")])
		#expect(state.integration == nil)
		#expect(state.externalKey == nil)
		#expect(state.sessionPersonaImageUrl == "/new.png")
		#expect(state.streamingAssistant == nil)
		#expect(state.turnWorkDurations.isEmpty)
		#expect(state.contextWindow?.fillPercentage == 20)
		#expect(state.promptText.isEmpty)
		#expect(state.activityLine == "Ready")
	}

	@Test("applyNewDraft clears identity to local draft")
	func applyNewDraftClearsIdentity() {
		var state = makeState()
		ChatSessionController.applyNewDraft(into: &state)

		#expect(state.sessionId == nil)
		#expect(state.sessionName == "New chat")
		#expect(state.transcript.isEmpty)
		#expect(state.integration == nil)
		#expect(state.integrationIconUrl == nil)
		#expect(state.externalKey == nil)
		#expect(state.sessionPersonaImageUrl == nil)
		#expect(state.streamingAssistant == nil)
		#expect(state.turnWorkDurations.isEmpty)
		#expect(state.contextWindow == nil)
		#expect(state.activityLine == "Ready")
		// Draft does not clear the in-progress prompt unless the store does elsewhere.
		#expect(state.promptText == "draft")
	}

	@Test("applyNewDraft can seed a persona image for the local draft")
	func applyNewDraftSeedsPersonaImage() {
		var state = makeState()
		ChatSessionController.applyNewDraft(
			into: &state,
			personaImageUrl: "/api/personas/image/mailman.png",
		)
		#expect(state.sessionId == nil)
		#expect(state.sessionPersonaImageUrl == "/api/personas/image/mailman.png")
	}

	@Test("applyExternalRefresh only updates poll fields")
	func applyExternalRefreshUpdatesPollFields() {
		var state = makeState()
		let detail = makeDetail(id: "s1", name: "Updated", transcript: [.user(text: "newer")])
		ChatSessionController.applyExternalRefresh(detail, into: &state)

		#expect(state.sessionName == "Updated")
		#expect(state.integrationIconUrl == nil)
		#expect(state.transcript == [.user(text: "newer")])
		#expect(state.activityLine == "Ready")
		// Identity keys / prompt / durations stay put.
		#expect(state.sessionId == "s1")
		#expect(state.externalKey == "ext-1")
		#expect(state.promptText == "draft")
		#expect(state.turnWorkDurations[0] == 1.5)
	}
}
