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
        #expect(store.draftPersonaName == nil)
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
        #expect(store.draftPersonaName == nil)
        #expect(store.promptFocusRequestId != originalId)
    }

    @Test("refreshPersonas stores the client persona list")
    func refreshPersonasStoresOptions() async {
        let client = MockChatClient()
        client.personas = [
            PersonaOption(
                name: "Toby",
                label: "Toby",
                imagePath: nil,
                imageUrl: nil,
                isDefault: true,
                isBuiltIn: true,
            ),
            PersonaOption(
                name: "Mailman",
                label: "Mailman",
                imagePath: nil,
                imageUrl: nil,
                isDefault: false,
                isBuiltIn: true,
            ),
        ]
        let store = ChatStore(client: client)
        await store.refreshPersonas()
        #expect(store.personaOptions.map(\.name) == ["Toby", "Mailman"])
    }

    @Test("startNewSession with persona pins draft persona and image")
    func startNewSessionPinsDraftPersona() async {
        let store = ChatStore()
        store.sessionId = "existing-session"
        let persona = PersonaOption(
            name: "Mailman",
            label: "Mailman",
            imagePath: "mailman.png",
            imageUrl: "/api/personas/image/mailman.png",
            isDefault: false,
            isBuiltIn: true,
        )

        await store.startNewSession(persona: persona)
        #expect(store.sessionId == nil)
        #expect(store.draftPersonaName == "Mailman")
        #expect(store.sessionPersonaImageUrl == "/api/personas/image/mailman.png")
    }

    @Test("submitPrompt creates a server session with the draft persona")
    func submitPromptCreatesSessionWithDraftPersona() async {
        let client = MockChatClient()
        client.createSessionResponse = CreateSessionResponse(
            id: "new-sess",
            name: "New chat",
            settings: SessionSettings(
                persona: "Mailman",
                modules: nil,
                dryRun: nil,
                debug: nil,
                projectId: nil,
            ),
        )
        client.sessionDetails["new-sess"] = SessionDetail(
            id: "new-sess",
            name: "New chat",
            transcript: [
                .user(text: "hello"),
                .assistant(text: "hi"),
            ],
            messageCount: 2,
            settings: nil,
            contextWindow: nil,
            personaImageUrl: "/api/personas/image/mailman.png",
            activePlan: nil,
            integration: nil,
            integrationIconUrl: nil,
            externalKey: nil,
        )
        client.sessions = [
            SessionSummary(id: "new-sess", name: "New chat", createdAt: nil, updatedAt: nil),
        ]
        let store = ChatStore(client: client)
        await store.startNewSession(
            persona: PersonaOption(
                name: "Mailman",
                label: "Mailman",
                imagePath: nil,
                imageUrl: "/api/personas/image/mailman.png",
                isDefault: false,
                isBuiltIn: true,
            ),
        )
        store.promptText = "hello"
        await store.submitPrompt()

        #expect(client.createSessionCalls == 1)
        #expect(client.lastCreateSessionPersona == "Mailman")
        #expect(client.streamTurnCalls == 1)
        #expect(store.sessionId == "new-sess")
    }

    @Test("selectSession clears a draft persona pin")
    func selectSessionClearsDraftPersona() async {
        let client = MockChatClient()
        client.sessionDetails["sess"] = SessionDetail(
            id: "sess",
            name: "Existing",
            transcript: [.user(text: "hi")],
            messageCount: 1,
            settings: nil,
            contextWindow: nil,
            personaImageUrl: "/p.png",
            activePlan: nil,
            integration: nil,
            integrationIconUrl: nil,
            externalKey: nil,
        )
        let store = ChatStore(client: client)
        store.draftPersonaName = "Mailman"
        await store.selectSession(id: "sess")
        #expect(store.draftPersonaName == nil)
        #expect(store.sessionId == "sess")
    }

    @Test("startNewChat with prompt does not interrupt an active turn")
    func startNewChatWithPromptGuardsActiveTurn() async {
        let store = ChatStore()
        store.isLoading = true
        store.sessionId = "existing-session"
        store.promptText = "existing prompt"

        await store.startNewChat(withPrompt: "new prompt")

        #expect(store.sessionId == "existing-session")
        #expect(store.promptText == "existing prompt")
    }

    @Test("contextFillPercentage is nil when no context window data")
    func contextFillNilWhenNoContextWindowData() {
        let store = ChatStore()
        #expect(store.contextFillPercentage == nil)
        #expect(store.contextWindowUnavailable == false)
    }

    @Test("validateCanSwitchTobyHome blocks during an active chat turn")
    func validateCanSwitchBlocksWhenLoading() {
        let store = ChatStore()
        store.isLoading = true
        #expect(throws: TobyHomeError.self) {
            try store.validateCanSwitchTobyHome()
        }
    }

    @Test("validateCanSwitchTobyHome blocks during recording")
    func validateCanSwitchBlocksWhenRecording() {
        let store = ChatStore()
        store.listenStatus = ListenStatusResponse(
            status: "recording",
            session: ListenSessionInfo(
                id: "sess-1",
                startedAt: "2026-07-09T10:00:00Z",
                sources: ListenSourceSelection(mic: true, system: false)
            ),
            outputDir: nil,
            message: nil,
            error: nil
        )
        #expect(throws: TobyHomeError.self) {
            try store.validateCanSwitchTobyHome()
        }
    }

    @Test("validateCanSwitchTobyHome allows idle store")
    func validateCanSwitchAllowsIdle() throws {
        let store = ChatStore()
        try store.validateCanSwitchTobyHome()
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

    // MARK: - Ask user

    @Test("promptForAskUser surfaces active prompt and pauses until option is chosen")
    func promptForAskUserOptionResume() async {
        let store = ChatStore()
        let payload = AskUserPromptPayload(
            turnId: "turn-1",
            requestId: "req-1",
            query: "Which calendar?",
            options: ["Personal", "Work"]
        )

        async let answer = store.promptForAskUser(payload)
        // Yield so the continuation is installed and the prompt is active.
        await Task.yield()
        #expect(store.activeAskUserPrompt?.query == "Which calendar?")
        #expect(store.activityLine == "Waiting for your choice…")

        store.submitAskUserOption(index: 1)
        let result = await answer
        #expect(result.selectedIndex == 1)
        #expect(result.selectedLabel == "Work")
        #expect(result.error == nil)
        #expect(store.activeAskUserPrompt == nil)

        guard case .askUserQA(_, let query, let answerText, let error) = store.transcript.last else {
            Issue.record("Expected optimistic askUserQA transcript entry")
            return
        }
        #expect(query == "Which calendar?")
        #expect(answerText == "Work")
        #expect(error == nil)
    }

    @Test("cancelAskUserPrompt records cancelled Q&A and resumes with error")
    func cancelAskUserPromptResumesWithError() async {
        let store = ChatStore()
        let payload = AskUserPromptPayload(
            turnId: "turn-1",
            requestId: "req-2",
            query: "Proceed?",
            options: ["Yes", "No"]
        )

        async let answer = store.promptForAskUser(payload)
        await Task.yield()
        store.cancelAskUserPrompt()
        let result = await answer
        #expect(result.error == "Cancelled")
        #expect(store.activeAskUserPrompt == nil)

        guard case .askUserQA(_, let query, _, let error) = store.transcript.last else {
            Issue.record("Expected cancelled askUserQA transcript entry")
            return
        }
        #expect(query == "Proceed?")
        #expect(error == "Cancelled")
    }

    @Test("custom ask-user answer is stored as the Q&A answer")
    func customAskUserAnswer() async {
        let store = ChatStore()
        let payload = AskUserPromptPayload(
            turnId: "turn-1",
            requestId: "req-3",
            query: "Anything else?",
            options: ["Done"]
        )

        async let answer = store.promptForAskUser(payload)
        await Task.yield()
        store.submitAskUserCustomAnswer("Also book lunch")
        let result = await answer
        #expect(result.selectedIndex == -1)
        #expect(result.selectedLabel == "Also book lunch")
        #expect(result.rawInput == "Also book lunch")

        guard case .askUserQA(_, _, let answerText, _) = store.transcript.last else {
            Issue.record("Expected custom askUserQA transcript entry")
            return
        }
        #expect(answerText == "Also book lunch")
    }

    // MARK: - Client injection (Phase 7)

    @Test("refreshSessions loads from injected client")
    func refreshSessionsUsesInjectedClient() async {
        let client = MockChatClient()
        client.sessions = [
            SessionSummary(
                id: "s1",
                name: "Alpha",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
            ),
            SessionSummary(
                id: "s2",
                name: "Beta",
                createdAt: "2026-01-02T00:00:00Z",
                updatedAt: "2026-01-02T00:00:00Z",
            ),
        ]
        let store = ChatStore(client: client)
        await store.refreshSessions()
        #expect(client.listSessionsLimit == 50)
        #expect(store.sessions.map(\.id) == ["s1", "s2"])
        #expect(store.toast == nil)
    }

    @Test("refreshSessions surfaces client errors as toast")
    func refreshSessionsSurfacesError() async {
        let client = MockChatClient()
        client.error = TobyClientError.serverError("down")
        let store = ChatStore(client: client)
        await store.refreshSessions()
        #expect(store.sessions.isEmpty)
        #expect(store.toast?.style == .error)
        #expect(store.toast?.message == "down")
    }

    @Test("selectSession applies detail from injected client")
    func selectSessionUsesInjectedClient() async {
        let client = MockChatClient()
        client.sessionDetails["s9"] = SessionDetail(
            id: "s9",
            name: "Injected",
            transcript: [.user(text: "hi from mock")],
            messageCount: 1,
            settings: nil,
            contextWindow: ContextWindowPayload(
                supported: true,
                contextWindowTokens: 100,
                fillPercentage: 12,
                unavailableReason: nil,
            ),
            personaImageUrl: "/p.png",
            activePlan: nil,
            integration: "slack",
            integrationIconUrl: "/i.png",
            externalKey: "ext",
        )
        let store = ChatStore(client: client)
        await store.selectSession(id: "s9")
        #expect(client.fetchSessionIds == ["s9"])
        #expect(store.sessionId == "s9")
        #expect(store.sessionName == "Injected")
        #expect(store.transcript == [.user(text: "hi from mock")])
        #expect(store.integration == "slack")
        #expect(store.externalKey == "ext")
        #expect(store.contextFillPercentage == 12)
        #expect(store.activityLine == "Ready")
    }

    @Test("deleteSession uses client and drafts when current session removed")
    func deleteSessionUsesInjectedClient() async {
        let client = MockChatClient()
        client.sessions = [
            SessionSummary(id: "keep", name: "Keep", createdAt: nil, updatedAt: nil),
            SessionSummary(id: "gone", name: "Gone", createdAt: nil, updatedAt: nil),
        ]
        let store = ChatStore(client: client)
        store.sessionId = "gone"
        store.transcript = [.user(text: "bye")]
        await store.deleteSession(id: "gone")
        #expect(client.deletedSessionIds == ["gone"])
        #expect(store.sessions.map(\.id) == ["keep"])
        #expect(store.sessionId == nil)
        #expect(store.transcript.isEmpty)
    }

    @Test("submitPrompt streams turn through injected client")
    func submitPromptUsesInjectedClient() async {
        let client = MockChatClient()
        client.turnDone = TurnDonePayload(
            turnId: "t1",
            text: "assistant reply",
            appliedActions: nil,
            sessionName: "Named chat",
            usage: nil,
            contextWindow: nil,
        )
        // Reload after stream uses fetchSession.
        client.sessionDetails["sess"] = SessionDetail(
            id: "sess",
            name: "Named chat",
            transcript: [
                .user(text: "hello"),
                .assistant(text: "assistant reply"),
            ],
            messageCount: 2,
            settings: nil,
            contextWindow: nil,
            personaImageUrl: nil,
            activePlan: nil,
            integration: nil,
            integrationIconUrl: nil,
            externalKey: nil,
        )
        client.sessions = [
            SessionSummary(id: "sess", name: "Named chat", createdAt: nil, updatedAt: nil),
        ]
        let store = ChatStore(client: client)
        store.sessionId = "sess"
        store.promptText = "hello"
        await store.submitPrompt()
        #expect(client.streamTurnCalls == 1)
        #expect(store.isLoading == false)
        #expect(store.sessionName == "Named chat")
        #expect(store.activityLine == "Ready")
        #expect(store.transcript.contains { entry in
            if case .user(let text, _) = entry { return text == "hello" }
            return false
        })
    }

    @Test("toggleRecording start uses native audio client")
    func toggleRecordingStartUsesNativeClient() async {
        let chat = MockChatClient()
        chat.status = AppStatus(
            version: "1.0",
            persona: "Toby",
            model: "m",
            hasConfiguredAIProvider: true,
            tobyDir: nil,
            contextWindow: nil,
            personaImageUrl: nil,
            connectedIntegrations: nil,
            personaCount: nil,
            skillCount: nil,
            skills: nil,
            transcription: nil,
        )
        let audio = MockNativeAudioClient()
        audio.startResponse = ListenStatusResponse(
            status: "recording",
            session: ListenSessionInfo(
                id: "live-1",
                startedAt: "2026-01-01T00:00:00Z",
                sources: ListenSourceSelection(mic: true, system: false),
            ),
            outputDir: "/tmp/live",
            message: nil,
            error: nil,
        )
        let store = ChatStore(client: chat, nativeAudioClient: audio)
        store.status = chat.status
        await store.toggleRecording()
        #expect(audio.startCalls == 1)
        #expect(store.isRecordingActive == true)
        #expect(store.activityLine == "Recording audio")
    }

    @Test("stop recording flips chrome to processing before native stop returns")
    func stopRecordingShowsProcessingBeforeNativeStopReturns() async {
        let chat = MockChatClient()
        chat.status = AppStatus(
            version: "1.0",
            persona: "Toby",
            model: "m",
            hasConfiguredAIProvider: true,
            tobyDir: nil,
            contextWindow: nil,
            personaImageUrl: nil,
            connectedIntegrations: nil,
            personaCount: nil,
            skillCount: nil,
            skills: nil,
            transcription: nil,
        )
        let audio = MockNativeAudioClient()
        audio.waitForStop = true
        audio.stopResponse = NativeAudioStopResponse(
            status: "idle",
            message: "saved",
            id: "live-1",
            outputDir: "/tmp/live",
            files: nil,
            errors: nil,
        )
        let store = ChatStore(client: chat, nativeAudioClient: audio)
        store.status = chat.status
        store.listenStatus = ListenStatusResponse(
            status: "recording",
            session: ListenSessionInfo(
                id: "live-1",
                startedAt: "2026-01-01T00:00:00Z",
                sources: ListenSourceSelection(mic: true, system: false),
            ),
            outputDir: "/tmp/live",
            message: nil,
            error: nil,
        )

        let task = Task { await store.toggleRecording() }
        for _ in 0 ..< 100 where audio.stopCalls == 0 {
            await Task.yield()
        }
        #expect(audio.stopCalls == 1)
        #expect(store.isRecordingActive == false)
        #expect(store.isRecordingProcessing == true)
        #expect(store.recordingChromeState == .processing)
        #expect(store.recordingProcessing?.stage == .generatingAudio)
        #expect(store.isRecordButtonDisabled)

        await store.toggleRecording()
        #expect(audio.startCalls == 0)
        #expect(audio.stopCalls == 1)

        audio.resumeStop()
        await task.value
    }

    @Test("toggleRecording does not start while processing")
    func toggleRecordingIgnoresStartWhileProcessing() async {
        let chat = MockChatClient()
        chat.status = AppStatus(
            version: "1.0",
            persona: "Toby",
            model: "m",
            hasConfiguredAIProvider: true,
            tobyDir: nil,
            contextWindow: nil,
            personaImageUrl: nil,
            connectedIntegrations: nil,
            personaCount: nil,
            skillCount: nil,
            skills: nil,
            transcription: nil,
        )
        let audio = MockNativeAudioClient()
        audio.startResponse = ListenStatusResponse(
            status: "recording",
            session: ListenSessionInfo(
                id: "live-2",
                startedAt: "2026-01-01T00:00:00Z",
                sources: ListenSourceSelection(mic: true, system: false),
            ),
            outputDir: "/tmp/live",
            message: nil,
            error: nil,
        )
        let store = ChatStore(client: chat, nativeAudioClient: audio)
        store.status = chat.status
        store.recordingProcessing = RecordingProcessingState(stage: .generatingAudio)
        await store.toggleRecording()
        #expect(audio.startCalls == 0)
        #expect(store.recordingChromeState == .processing)
    }
}
