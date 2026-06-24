import Testing
@testable import TobyApp

@MainActor
@Suite("ChatStore")
struct ChatStoreTests {

    @Test("recording chat prompt includes name, date, and hour")
    func recordingChatPromptIncludesDetails() {
        let prompt = makeRecordingChatPrompt(
            name: "My Standup",
            dateText: "June 22, 2026",
            hourText: "10 AM"
        )
        #expect(
            prompt == "Summarize the transcript of the recording named \"My Standup\" on \"June 22, 2026\" at \"10 AM\" oclock."
        )
    }

    @Test("recording chat prompt falls back to Recording when name is blank")
    func recordingChatPromptFallsBackForBlankName() {
        let prompt = makeRecordingChatPrompt(name: "   ", dateText: "June 22, 2026", hourText: "10 AM")
        #expect(prompt.contains("named \"Recording\""))
    }

    @Test("focusPrompt generates a new focus request ID")
    func focusPromptChangesRequestId() {
        let store = ChatStore()
        let originalId = store.promptFocusRequestId
        store.focusPrompt()
        #expect(store.promptFocusRequestId != originalId)
    }

    @Test("startNewSession focuses prompt when current session is already clean")
    func startNewSessionFocusesPromptOnCleanSession() async {
        let store = ChatStore()
        store.sessionId = "existing-clean-session"
        store.transcript = []
        store.streamingAssistant = nil

        let originalId = store.promptFocusRequestId
        await store.startNewSession()
        #expect(store.promptFocusRequestId != originalId)
    }
}
