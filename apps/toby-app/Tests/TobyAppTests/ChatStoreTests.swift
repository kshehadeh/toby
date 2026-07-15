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

    @Test("startNewSession resets to draft state without creating a server session")
    func startNewSessionResetsToDraft() async {
        let store = ChatStore()
        store.sessionId = "existing-session"
        store.sessionName = "Old chat"
        store.transcript = [.user(text: "hello")]

        let originalId = store.promptFocusRequestId
        await store.startNewSession()
        #expect(store.sessionId == nil)
        #expect(store.sessionName == "New chat")
        #expect(store.transcript.isEmpty)
        #expect(store.promptFocusRequestId != originalId)
    }

    @Test("startNewSession on already-clean draft still focuses prompt")
    func startNewSessionOnDraftFocusesPrompt() async {
        let store = ChatStore()
        store.sessionId = nil
        store.transcript = []

        let originalId = store.promptFocusRequestId
        await store.startNewSession()
        #expect(store.sessionId == nil)
        #expect(store.promptFocusRequestId != originalId)
    }

    @Test("contextFillPercentage is nil when no context window data")
    func contextFillNilWhenNoContextWindowData() {
        let store = ChatStore()
        #expect(store.contextFillPercentage == nil)
        #expect(store.contextWindowUnavailable == false)
    }

    @Test("contextFillPercentage comes from API payload")
    func contextFillComesFromApiPayload() {
        let store = ChatStore()
        store.contextWindow = ContextWindowPayload(
            supported: true,
            contextWindowTokens: 128_000,
            fillPercentage: 50,
            unavailableReason: nil
        )
        #expect(store.contextFillPercentage == 50)
        #expect(store.contextWindowUnavailable == false)
    }

    @Test("contextFillPercentage shows empty gauge for supported provider without usage")
    func contextFillShowsEmptyGaugeForSupportedProviderWithoutUsage() {
        let store = ChatStore()
        store.contextWindow = ContextWindowPayload(
            supported: true,
            contextWindowTokens: 128_000,
            fillPercentage: nil,
            unavailableReason: nil
        )
        #expect(store.contextFillPercentage == 0)
        #expect(store.contextWindowUnavailable == false)
    }

    @Test("context window merge preserves existing fill percentage")
    func contextWindowMergePreservesExistingFillPercentage() {
        let current = ContextWindowPayload(
            supported: true,
            contextWindowTokens: 128_000,
            fillPercentage: 42,
            unavailableReason: nil
        )
        let incoming = ContextWindowPayload(
            supported: true,
            contextWindowTokens: 128_000,
            fillPercentage: nil,
            unavailableReason: nil
        )

        #expect(mergeContextWindowPayload(current: current, incoming: incoming)?.fillPercentage == 42)
    }

    @Test("context window merge accepts newer filled payload")
    func contextWindowMergeAcceptsNewerFilledPayload() {
        let current = ContextWindowPayload(
            supported: true,
            contextWindowTokens: 128_000,
            fillPercentage: 42,
            unavailableReason: nil
        )
        let incoming = ContextWindowPayload(
            supported: true,
            contextWindowTokens: 128_000,
            fillPercentage: 43,
            unavailableReason: nil
        )

        #expect(mergeContextWindowPayload(current: current, incoming: incoming)?.fillPercentage == 43)
    }

    @Test("contextWindowUnavailable is true for unsupported provider payload")
    func contextWindowUnavailableForUnsupportedProviderPayload() {
        let store = ChatStore()
        store.contextWindow = ContextWindowPayload(
            supported: false,
            contextWindowTokens: nil,
            fillPercentage: nil,
            unavailableReason: "Provider doesn't support context window information."
        )
        #expect(store.contextFillPercentage == nil)
        #expect(store.contextWindowUnavailable == true)
    }

    @Test("contextWindowUnavailable falls back to status payload")
    func contextWindowUnavailableFallsBackToStatusPayload() {
        let store = ChatStore()
        store.status = AppStatus(
            version: "1.0",
            persona: "Toby",
            model: "openai/gpt-5-mini",
            hasConfiguredAIProvider: nil,
            tobyDir: nil,
            contextWindow: ContextWindowPayload(
                supported: false,
                contextWindowTokens: nil,
                fillPercentage: nil,
                unavailableReason: "Provider doesn't support context window information."
            ),
            personaImageUrl: nil,
            connectedIntegrations: nil,
            personaCount: nil,
            skillCount: nil,
            skills: nil,
            transcription: nil
        )
        #expect(store.contextFillPercentage == nil)
        #expect(store.contextWindowUnavailable == true)
    }

    @Test("cancelActiveTurn is a no-op when not loading")
    func cancelActiveTurnNoOpWhenNotLoading() {
        let store = ChatStore()
        store.sessionId = "test-session"
        // Should not crash or change state when not loading
        store.cancelActiveTurn()
        #expect(store.isLoading == false)
    }

    @Test("isServerReady is false until status is set and connect/restart finish")
    func isServerReadyRequiresStatusAndIdleLifecycle() {
        let store = ChatStore()
        #expect(store.isServerReady == false)

        store.isServerConnecting = true
        #expect(store.isServerReady == false)

        store.isServerConnecting = false
        store.status = AppStatus(
            version: "1.0",
            persona: "Toby",
            model: "openai/gpt-5-mini",
            hasConfiguredAIProvider: true,
            tobyDir: nil,
            contextWindow: nil,
            personaImageUrl: nil,
            connectedIntegrations: nil,
            personaCount: nil,
            skillCount: nil,
            skills: nil,
            transcription: nil
        )
        #expect(store.isServerReady == true)

        store.isServerRestarting = true
        #expect(store.isServerReady == false)
    }
}
