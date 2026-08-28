import AppKit
import Foundation
import Observation

@Observable
@MainActor
final class ChatStore {
	var status: AppStatus?
	var daemonStatus: DaemonStatus?
	var sessionId: String?
	var sessionName: String = "New chat"
	var sessions: [SessionSummary] = []
	var isSessionsLoading = false
	var transcript: [TranscriptEntry] = []
	var streamingAssistant: StreamingAssistantState?
	var activityLine: String = "Connecting…"
	var promptText: String = ""
	var pendingAttachments: [ChatAttachmentDraft] = []
	private var localAttachmentPreviewsByTranscriptText: [String: [ChatTranscriptAttachment]] = [:]
	var promptFocusRequestId = UUID()
	var isLoading = false
	var isSelectingSession = false
	var isServerRestarting = false
	/// True while bootstrap is ensuring / replacing the local daemon.
	var isServerConnecting = false
	/// User-visible detail for server lifecycle (bootstrap / restart steps).
	var serverLifecycleMessage: String?

	/// True once the daemon handshake succeeded and status has been fetched,
	/// and the server is not mid-connect or mid-restart. Use this to gate UI
	/// that depends on configuration / plugins (e.g. onboarding).
	var isServerReady: Bool {
		status != nil && !isServerConnecting && !isServerRestarting
	}
	var listenStatus: ListenStatusResponse?
	var isListenRequestInFlight = false
	var toast: AppToastState?
	var recordingProcessing: RecordingProcessingState?
	var turnWorkDurations: [Int: TimeInterval] = [:]
	var activeAskUserPrompt: ActiveAskUserPrompt?
	var integration: String?
	var integrationIconUrl: String?
	var externalKey: String?
	var sessionPersonaImageUrl: String?
	/// Persona pinned for the current local draft. `nil` uses the configured default.
	var draftPersonaName: String?
	/// Personas available for the new-chat toolbar menu.
	var personaOptions: [PersonaOption] = []
	var contextWindow: ContextWindowPayload?
	private var activeTurnId: String?
	private var isCancelling = false
	private var lastInboundUpdatedAt: String?

	var isExternalSession: Bool {
		integration != nil && externalKey != nil
	}

	var resolvedIntegrationIconUrl: URL? {
		guard let integrationIconUrl else { return nil }
		return URL(string: ConfigReader.baseURL().absoluteString + integrationIconUrl)
	}

	/// Image for the active draft or session persona, then the configured default.
	var resolvedPersonaImagePath: String {
		sessionPersonaImageUrl
			?? personaOptions.first(where: { $0.name == draftPersonaName })?.imageUrl
			?? status?.personaImageUrl
			?? "/api/personas/image/default.png"
	}

	var resolvedPersonaImageUrl: URL? {
		URL(string: ConfigReader.baseURL().absoluteString + resolvedPersonaImagePath)
	}

	var contextFillPercentage: Int? {
		let info = contextWindow ?? status?.contextWindow
		guard info?.supported == true else { return nil }
		return info?.fillPercentage ?? 0
	}

	var contextWindowUnavailable: Bool {
		(contextWindow ?? status?.contextWindow)?.supported == false
	}

	var activeWorkStartDate: Date? {
		isLoading ? activeTurnStartedAt : nil
	}

	var isRecordingActive: Bool {
		listenStatus?.isLiveCapture == true
	}

	var isRecordingProcessing: Bool {
		recordingProcessing?.isActive == true || listenStatus?.isFinalizing == true
	}

	var recordingChromeState: RecordingChromeState {
		if isRecordingActive { return .recording }
		if isRecordingProcessing { return .processing }
		return .idle
	}

	var isRecordButtonDisabled: Bool {
		status == nil || isListenRequestInFlight || isRecordingProcessing
	}

	var attachmentCapability: ChatAttachmentCapability? {
		status?.attachmentCapability
	}

	var canAttachFiles: Bool {
		attachmentCapability?.supported == true && !isLoading
	}

	var attachmentUnavailableReason: String {
		attachmentCapability?.reason ?? "The selected model does not support file attachments."
	}

	var hasCleanCurrentSession: Bool {
		sessionId != nil && transcript.isEmpty && streamingAssistant == nil
	}

	private let client: any ChatClientable
	private let nativeAudioClient: any NativeAudioClientable
	private var assistantHeader = ""
	private var assistantBuffer = ""
	private var sawToolCallThisTurn = false
	private var activeTurnStartedAt: Date?
	private var activeTurnUserIndex: Int?
	private var askUserContinuation: CheckedContinuation<(selectedIndex: Int, selectedLabel: String, rawInput: String, error: String?), Never>?
	@ObservationIgnored
	nonisolated(unsafe) private var externalSessionRefreshTask: Task<Void, Never>?

	init(
		client: any ChatClientable = TobyClient(),
		nativeAudioClient: any NativeAudioClientable = NativeAudioClient(),
	) {
		self.client = client
		self.nativeAudioClient = nativeAudioClient
	}

	deinit {
		externalSessionRefreshTask?.cancel()
	}

	func bootstrap() async {
		isServerConnecting = true
		serverLifecycleMessage = "Checking server…"
		activityLine = "Checking server…"
		do {
			try await DaemonBootstrap.ensureServerAvailable(baseURL: client.baseURL) { [weak self] message in
				Task { @MainActor in
					guard let self else { return }
					self.serverLifecycleMessage = message
					self.activityLine = message
				}
			}
			activityLine = "Connecting…"
			serverLifecycleMessage = "Connecting…"
			status = try await client.fetchStatus()
			if let native = try? await nativeAudioClient.status() {
				applyRefreshedListenStatus(native)
			}
			await refreshDaemonStatus()
			await refreshSessions()
			await refreshPersonas()
			await startNewSession()
			isServerConnecting = false
			serverLifecycleMessage = nil
			if !isLoading {
				activityLine = "Ready"
			}
		} catch {
			isServerConnecting = false
			serverLifecycleMessage = nil
			showErrorToast(error.localizedDescription)
			activityLine = "Daemon unavailable"
		}
	}

	func refreshSessions() async {
		isSessionsLoading = true
		defer { isSessionsLoading = false }
		do {
			sessions = try await client.listSessions(limit: 50)
		} catch {
			showErrorToast(error.localizedDescription)
		}
	}

	func refreshPersonas() async {
		do {
			personaOptions = try await client.listPersonas()
		} catch {
			// Menu still offers Chat with Default Persona.
		}
	}

	func refreshStatus() async {
		do {
			status = try await client.fetchStatus()
			if let native = try? await nativeAudioClient.status() {
				applyRefreshedListenStatus(native)
			}
		} catch {
			showErrorToast(error.localizedDescription)
		}
		await refreshDaemonStatus()
	}

	func refreshDaemonStatus() async {
		guard !isServerRestarting else { return }
		do {
			daemonStatus = try await client.fetchDaemonStatus()
		} catch {
			daemonStatus = nil
		}
		let inboundUpdatedAt = daemonStatus?.chatInbound?.updatedAt
		if inboundUpdatedAt != lastInboundUpdatedAt {
			lastInboundUpdatedAt = inboundUpdatedAt
			await refreshSessions()
		}
	}

	func restartServer() async {
		guard !isServerRestarting else { return }
		isServerRestarting = true
		status = nil
		daemonStatus = nil
		serverLifecycleMessage = "Restarting server…"
		activityLine = "Restarting server…"
		toast = AppToastState(
			style: .progress,
			title: "Restarting server",
			message: "Stopping the current server and starting the one for this app.",
		)
		do {
			try await client.restartDaemon { [weak self] message in
				Task { @MainActor in
					guard let self else { return }
					self.serverLifecycleMessage = message
					self.activityLine = message
					self.toast = AppToastState(
						style: .progress,
						title: "Restarting server",
						message: message,
					)
				}
			}
			status = try await client.fetchStatus()
			if let native = try? await nativeAudioClient.status() {
				applyRefreshedListenStatus(native)
			}
			isServerRestarting = false
			serverLifecycleMessage = nil
			await refreshDaemonStatus()
			activityLine = "Ready"
			toast = AppToastState(
				style: .success,
				title: "Server restarted",
				message: "Toby is connected again.",
			)
		} catch {
			isServerRestarting = false
			serverLifecycleMessage = nil
			activityLine = "Daemon unavailable"
			toast = AppToastState(
				style: .error,
				title: "Server restart failed",
				message: error.localizedDescription,
			)
			await refreshDaemonStatus()
		}
	}

	// MARK: - Home directory switch

	/// Switches the Toby data root in-process: stops the daemon and native
	/// server, applies the preference, clears chat state, and bootstraps the
	/// new home. Pass `nil` to restore the default `~/.toby`.
	///
	/// Posts `.tobyHomeDidChange` on success so the shell can reset feature stores.
	func switchTobyHome(to path: String?) async throws {
		try validateCanSwitchTobyHome()

		let targetOverride = AppearancePreferences.normalizedOverride(path)
		let targetResolved: String
		if let targetOverride {
			targetResolved = targetOverride
		} else {
			// Preview default without applying yet: ignore current override env/prefs.
			targetResolved = ConfigReader.defaultTobyDir()
		}

		let currentResolved = ConfigReader.resolveTobyDir()
		if ConfigReader.standardizePath(targetResolved) == ConfigReader.standardizePath(currentResolved) {
			// Still update preference if we're clearing/setting the same resolved path
			// via a different mechanism (e.g. custom path that equals default).
			let currentOverride = AppearancePreferences.shared.tobyDirOverride
			if AppearancePreferences.normalizedOverride(currentOverride) == targetOverride {
				throw TobyHomeError.alreadyCurrent
			}
		}

		if let targetOverride {
			try ConfigReader.ensureWritableDirectory(at: targetOverride)
		} else {
			try ConfigReader.ensureWritableDirectory(at: targetResolved)
		}

		let oldBaseURL = client.baseURL
		isServerConnecting = true
		status = nil
		daemonStatus = nil
		serverLifecycleMessage = "Stopping server…"
		activityLine = "Stopping server…"
		toast = AppToastState(
			style: .progress,
			title: "Switching home directory",
			message: "Stopping the current server…",
		)

		// Best-effort stop of work against the old home.
		if isLoading, let sessionId, let activeTurnId {
			await client.cancelTurn(sessionId: sessionId, turnId: activeTurnId)
		}
		clearSessionStateForHomeSwitch()

		do {
			try await DaemonBootstrap.stopDaemon(baseURL: oldBaseURL)
		} catch {
			// Continue — force path inside stop may have cleaned up; proceed carefully.
			ServerEventLog.append(
				"homeSwitch.stopDaemonError error=\(error.localizedDescription)"
			)
		}

		NativeServer.shared.stop()

		serverLifecycleMessage = "Switching home…"
		activityLine = "Switching home…"
		AppearancePreferences.shared.tobyDirOverride = targetOverride
		// Ensure process env matches even if preference was already equivalent.
		ConfigReader.syncTobyDirEnvironment()
		try ConfigReader.ensureWritableDirectory(at: ConfigReader.resolveTobyDir())

		NativeServer.shared.start()

		serverLifecycleMessage = "Starting server…"
		activityLine = "Starting server…"
		toast = AppToastState(
			style: .progress,
			title: "Switching home directory",
			message: "Starting the server for the new home…",
		)

		do {
			try await DaemonBootstrap.ensureServerAvailable(baseURL: client.baseURL) {
				[weak self] message in
				Task { @MainActor in
					guard let self else { return }
					self.serverLifecycleMessage = message
					self.activityLine = message
					self.toast = AppToastState(
						style: .progress,
						title: "Switching home directory",
						message: message,
					)
				}
			}
			status = try await client.fetchStatus()
			if let native = try? await nativeAudioClient.status() {
				applyRefreshedListenStatus(native)
			}
			await refreshDaemonStatus()
			await refreshSessions()
			await refreshPersonas()
			await startNewSession()
			isServerConnecting = false
			serverLifecycleMessage = nil
			activityLine = "Ready"
			toast = AppToastState(
				style: .success,
				title: "Home directory updated",
				message: ConfigReader.resolveTobyDir(),
			)
			NotificationCenter.default.post(name: .tobyHomeDidChange, object: nil)
		} catch {
			isServerConnecting = false
			serverLifecycleMessage = nil
			activityLine = "Daemon unavailable"
			toast = AppToastState(
				style: .error,
				title: "Home switch failed",
				message: error.localizedDescription,
			)
			throw error
		}
	}

	/// Preconditions for switching home (idle process, no active capture).
	func validateCanSwitchTobyHome() throws {
		if isLoading {
			throw TobyHomeError.busy("Finish or cancel the current chat turn before switching home.")
		}
		if isRecordingActive || isListenRequestInFlight || recordingProcessing != nil {
			throw TobyHomeError.busy("Stop recording before switching home.")
		}
		if isServerConnecting || isServerRestarting {
			throw TobyHomeError.busy("Wait for the server to finish connecting before switching home.")
		}
	}

	private func clearSessionStateForHomeSwitch() {
		stopExternalSessionRefreshLoop()
		sessionId = nil
		sessionName = "New chat"
		sessions = []
		transcript = []
		streamingAssistant = nil
		pendingAttachments = []
		localAttachmentPreviewsByTranscriptText = [:]
		activeAskUserPrompt = nil
		if let askUserContinuation {
			askUserContinuation.resume(returning: (
				selectedIndex: -1,
				selectedLabel: "",
				rawInput: "",
				error: "Home directory changed"
			))
			self.askUserContinuation = nil
		}
		integration = nil
		integrationIconUrl = nil
		externalKey = nil
		sessionPersonaImageUrl = nil
		draftPersonaName = nil
		contextWindow = nil
		activeTurnId = nil
		isCancelling = false
		isLoading = false
		isSelectingSession = false
		turnWorkDurations = [:]
		assistantHeader = ""
		assistantBuffer = ""
		sawToolCallThisTurn = false
		activeTurnStartedAt = nil
		activeTurnUserIndex = nil
		lastInboundUpdatedAt = nil
		promptText = ""
	}

	func daemonStatusRefreshLoop() async {
		while !Task.isCancelled {
			await refreshDaemonStatus()
			try? await Task.sleep(nanoseconds: 5_000_000_000)
		}
	}

	private func startExternalSessionRefreshLoop() {
		stopExternalSessionRefreshLoop()
		guard isExternalSession else { return }
		externalSessionRefreshTask = Task { [weak self] in
			while !Task.isCancelled {
				try? await Task.sleep(nanoseconds: 2_000_000_000)
				guard let self, !Task.isCancelled else { return }
				await self.refreshCurrentSessionIfExternal()
			}
		}
	}

	private func stopExternalSessionRefreshLoop() {
		externalSessionRefreshTask?.cancel()
		externalSessionRefreshTask = nil
	}

	private func refreshCurrentSessionIfExternal() async {
		guard isExternalSession, let currentSessionId = sessionId, !isLoading else { return }
		do {
			let detail = try await client.fetchSession(id: currentSessionId)
			guard sessionId == detail.id, !isLoading else { return }
			var identity = sessionIdentityState()
			ChatSessionController.applyExternalRefresh(detail, into: &identity)
			applySessionIdentityState(identity)
		} catch {
			// Keep existing transcript on refresh failure.
		}
	}

	func toggleRecording() async {
		guard !isListenRequestInFlight else { return }
		if isRecordingActive {
			await stopActiveRecording()
		} else if isRecordingProcessing {
			// Extra Stop / Record clicks while finalize or transcription runs
			// must not start a new take.
			return
		} else {
			await startRecording()
		}
	}

	func stopActiveRecording() async {
		guard !isListenRequestInFlight, isRecordingActive else { return }
		await stopRecording()
	}

	/// Ignore a lagging "still recording" native snapshot while stop / finalize
	/// is already in flight so chrome cannot flip back to live capture.
	private func applyRefreshedListenStatus(_ native: ListenStatusResponse) {
		if (isListenRequestInFlight || recordingProcessing?.isActive == true), native.isLiveCapture {
			return
		}
		listenStatus = native
		if native.isFinalizing, recordingProcessing?.isActive != true {
			recordingProcessing = RecordingProcessingState(
				recordingId: native.session?.id,
				stage: .generatingAudio,
			)
		}
	}

	// MARK: - Recording UI bridge

	private func recordingUIState() -> ChatRecordingUIState {
		ChatRecordingUIState(
			listenStatus: listenStatus,
			recordingProcessing: recordingProcessing,
			toast: toast,
			activityLine: activityLine,
		)
	}

	private func applyRecordingUIState(_ state: ChatRecordingUIState) {
		listenStatus = state.listenStatus
		recordingProcessing = state.recordingProcessing
		toast = state.toast
		activityLine = state.activityLine
	}

	private func showErrorToast(_ message: String, title: String = "Something went wrong") {
		let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		toast = AppToastState(style: .error, title: title, message: trimmed)
	}

	func submitIssue(type: String, details: String) async {
		activityLine = "Submitting issue report…"
		defer { activityLine = "Ready" }
		do {
			let result = try await client.createIssue(type: type, details: details)
			if result.ok, let url = result.url {
				toast = AppToastState(
					style: .success,
					title: "Issue created",
					message: "View the issue on GitHub.",
					action: .openURL(url: url)
				)
				return
			}
			if let fallbackUrl = result.fallbackUrl {
				if let url = URL(string: fallbackUrl), NSWorkspace.shared.open(url) {
					toast = AppToastState(
						style: .success,
						title: "Issue report opened",
						message: result.reason ?? "Complete the report in your browser.",
					)
				} else {
					toast = AppToastState(
						style: .error,
						title: "Could not open browser",
						message: fallbackUrl,
					)
				}
				return
			}
			toast = AppToastState(
				style: .error,
				title: "Issue report failed",
				message: "Unexpected response from server.",
			)
		} catch {
			toast = AppToastState(
				style: .error,
				title: "Issue report failed",
				message: error.localizedDescription,
			)
		}
	}

	func selectSession(id: String) async {
		guard !isLoading else { return }
		guard ChatSessionController.shouldSelectSession(
			requestedId: id,
			currentSessionId: sessionId,
			transcriptIsEmpty: transcript.isEmpty,
			isLoading: isLoading,
		) else {
			focusPrompt()
			return
		}
		isSelectingSession = true
		defer { isSelectingSession = false }
		do {
			let detail = try await client.fetchSession(id: id)
			var identity = sessionIdentityState()
			ChatSessionController.applyLoadedSession(detail, into: &identity)
			applySessionIdentityState(identity)
			draftPersonaName = nil
			startExternalSessionRefreshLoop()
			focusPrompt()
		} catch {
			showErrorToast(error.localizedDescription)
		}
	}

	func startNewSession(persona: PersonaOption? = nil) async {
		guard !isLoading else { return }
		var identity = sessionIdentityState()
		ChatSessionController.applyNewDraft(
			into: &identity,
			personaImageUrl: persona?.imageUrl,
		)
		applySessionIdentityState(identity)
		draftPersonaName = persona?.name
		stopExternalSessionRefreshLoop()
		focusPrompt()
	}

	func startChatAboutRecording(recordingId: String, name: String, dateText: String, hourText: String) async {
		guard !isLoading else { return }
		await startNewSession()
		promptText = makeRecordingChatPrompt(name: name, dateText: dateText, hourText: hourText)
		await submitPrompt()
		// Link the recording to the new chat session so the UI can offer
		// "Show Chat" instead of "Start Chat" on subsequent views.
		if let newSessionId = sessionId {
			_ = try? await client.updateRecordingChatSession(id: recordingId, chatSessionId: newSessionId)
		}
	}

	func startChatWithPrompt(_ prompt: String) async {
		guard !isLoading else { return }
		await startNewSession()
		promptText = prompt
		focusPrompt()
	}

	func startNewChat(withPrompt prompt: String) async {
		guard !isLoading else { return }
		await startNewSession()
		clearAttachments()
		promptText = prompt
		await submitPrompt()
	}

	func focusPrompt() {
		promptFocusRequestId = UUID()
	}

	func deleteSession(id: String) async {
		guard !isLoading else { return }
		do {
			try await client.deleteSession(id: id)
			await refreshSessions()
			if sessionId == id {
				await startNewSession()
			}
		} catch {
			showErrorToast(error.localizedDescription)
		}
	}

	private func startRecording() async {
		isListenRequestInFlight = true
		defer { isListenRequestInFlight = false }
		if status?.transcription?.configured != true {
			toast = ChatRecordingController.unconfiguredTranscriptionToast()
		}
		var ui = recordingUIState()
		do {
			let sources = ConfigReader.listenRecordSources()
			let status = try await nativeAudioClient.start(mic: sources.mic, system: sources.system)
			ChatRecordingController.applyStartSuccess(status: status, into: &ui)
			applyRecordingUIState(ui)
		} catch {
			let status = try? await nativeAudioClient.status()
			ChatRecordingController.applyStartFailure(
				message: error.localizedDescription,
				status: status,
				into: &ui,
			)
			applyRecordingUIState(ui)
		}
	}

	private func stopRecording() async {
		isListenRequestInFlight = true
		defer { isListenRequestInFlight = false }

		var ui = recordingUIState()
		// Drop live-capture chrome immediately so UI (long-recording prompt,
		// active sidebar row, record button) does not treat async stop /
		// combine / transcription as "still recording".
		ChatRecordingController.applyStoppingCapture(
			current: listenStatus,
			into: &ui,
		)
		applyRecordingUIState(ui)
		// Let SwiftUI paint processing chrome before native stop hops back
		// onto the main actor for recorder teardown.
		await Task.yield()

		do {
			let result = try await nativeAudioClient.stop()
			let classification = ChatRecordingController.classifyStopResult(result)
			ui = recordingUIState()
			ChatRecordingController.applyStopClassification(classification, into: &ui)
			applyRecordingUIState(ui)

			guard case .readyForTranscription(let id, _) = classification else { return }

			do {
				_ = try await client.streamTranscribeRecording(id: id) { message in
					Task { @MainActor in
						var progress = self.recordingUIState()
						ChatRecordingController.applyTranscriptionProgress(
							recordingId: id,
							message: message,
							into: &progress,
						)
						self.applyRecordingUIState(progress)
					}
				}
				ui = recordingUIState()
				ChatRecordingController.applyTranscriptionComplete(recordingId: id, into: &ui)
				applyRecordingUIState(ui)
			} catch {
				ui = recordingUIState()
				ChatRecordingController.applyTranscriptionFailed(
					recordingId: id,
					errorDescription: error.localizedDescription,
					into: &ui,
				)
				applyRecordingUIState(ui)
			}
		} catch {
			ui = recordingUIState()
			let status = try? await nativeAudioClient.status()
			ChatRecordingController.applyNativeStopFailed(
				message: error.localizedDescription,
				status: status,
				into: &ui,
			)
			applyRecordingUIState(ui)
		}
	}

	private func createSessionAndSubmit() async {
		do {
			let created = try await client.createSession(persona: draftPersonaName)
			sessionId = created.id
			sessionName = created.name
			stopExternalSessionRefreshLoop()
			await refreshSessions()
			await submitPrompt()
		} catch {
			showErrorToast(error.localizedDescription)
			activityLine = "Error"
		}
	}

	func submitPrompt() async {
		let text = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
		let attachments = pendingAttachments
		guard (!text.isEmpty || !attachments.isEmpty), !isLoading else { return }

		// Lazily create the server session on first prompt so we never
		// pollute the session list with empty chats.
		guard let sessionId else {
			await createSessionAndSubmit()
			return
		}

		promptText = ""
		let userText = ChatAttachmentDrafting.userTranscriptText(text: text, attachments: attachments)
		let transcriptAttachments = ChatAttachmentDrafting.transcriptAttachments(from: attachments)
		if !transcriptAttachments.isEmpty {
			localAttachmentPreviewsByTranscriptText[userText] = transcriptAttachments
		}
		transcript.append(.user(text: userText, attachments: transcriptAttachments))
		let userTurnStartIndex = transcript.count - 1
		activeTurnStartedAt = Date()
		activeTurnUserIndex = userTurnStartIndex
		isLoading = true
		isCancelling = false
		activityLine = "Thinking…"
		streamingAssistant = nil
		assistantHeader = ""
		assistantBuffer = ""
		sawToolCallThisTurn = false

		let turnId = UUID().uuidString
		activeTurnId = turnId

		do {
			let done = try await client.streamTurn(sessionId: sessionId, text: text, attachments: attachments, clientTurnId: turnId, onEvent: { event in
				self.applyTurnEvent(event)
			}, onAskUser: { [weak self] prompt in
				guard let self else { return (-1, "", "", "Prompt dismissed") }
				return await self.promptForAskUser(prompt)
			})
			if !assistantBuffer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				commitTurnAssistantSegment(id: UUID().uuidString, interim: false)
			}
			let reply = done.text.trimmingCharacters(in: .whitespacesAndNewlines)
			if !reply.isEmpty
				&& !ChatTurnEngine.hasAssistantReplyBody(
					reply,
					sinceIndex: userTurnStartIndex,
					in: transcript,
				)
			{
				assistantHeader = status?.persona ?? "Assistant"
				assistantBuffer = reply
				commitTurnAssistantSegment(id: UUID().uuidString, interim: false)
			}
			if let nextSessionName = done.sessionName?.trimmingCharacters(
				in: .whitespacesAndNewlines,
			), !nextSessionName.isEmpty {
				sessionName = nextSessionName
			}
			contextWindow = done.contextWindow
			await reloadTranscriptFromServer()
			streamingAssistant = nil
			activityLine = "Ready"
			clearAttachments()
			await refreshSessions()
		} catch {
			if isCancelling {
				if !assistantBuffer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
					commitTurnAssistantSegment(id: UUID().uuidString, interim: false)
				}
				transcript.append(.notice(text: "Turn cancelled.", tone: nil))
				activityLine = "Ready"
				clearAttachments()
			} else {
				showErrorToast(error.localizedDescription)
				transcript.append(.error(text: error.localizedDescription))
				activityLine = "Error"
			}
		}

		// Record the local fallback before the work group transitions from active
		// to completed. Otherwise SwiftUI can render a completed group while the
		// duration map is still empty.
		recordTurnDuration()
		isLoading = false
		isCancelling = false
		activeTurnId = nil
	}

	func addAttachmentFiles(_ urls: [URL]) {
		let outcome = ChatAttachmentDrafting.adding(
			urls: urls,
			to: pendingAttachments,
			capability: attachmentCapability,
			canAttach: canAttachFiles,
			unavailableReason: attachmentUnavailableReason,
		)
		pendingAttachments = outcome.pendingAttachments
		for toast in outcome.toasts {
			showErrorToast(toast.message, title: toast.title)
		}
	}

	func removeAttachment(id: UUID) {
		pendingAttachments.removeAll { $0.id == id }
	}

	func clearAttachments() {
		pendingAttachments = []
	}

	func cancelActiveTurn() {
		guard isLoading, !isCancelling, let sessionId, let turnId = activeTurnId else { return }
		isCancelling = true
		Task {
			await client.cancelTurn(sessionId: sessionId, turnId: turnId)
		}
	}

	private func recordTurnDuration() {
		if let started = activeTurnStartedAt, let index = activeTurnUserIndex {
			turnWorkDurations[index] = Date().timeIntervalSince(started)
		}
		activeTurnStartedAt = nil
		activeTurnUserIndex = nil
	}

	/// Presents the interactive ask-user control and suspends until the user answers.
	/// Internal for unit tests; production callers use the SSE `onAskUser` path.
	func promptForAskUser(_ payload: AskUserPromptPayload) async -> (selectedIndex: Int, selectedLabel: String, rawInput: String, error: String?) {
		await withCheckedContinuation { continuation in
			self.askUserContinuation = continuation
			self.activeAskUserPrompt = ActiveAskUserPrompt(
				id: payload.requestId,
				turnId: payload.turnId,
				requestId: payload.requestId,
				query: payload.query,
				options: payload.options
			)
			self.activityLine = "Waiting for your choice…"
		}
	}

	func submitAskUserOption(index: Int) {
		guard let prompt = activeAskUserPrompt, let continuation = askUserContinuation else { return }
		guard index >= 0, index < prompt.options.count else { return }
		let label = prompt.options[index]
		askUserContinuation = nil
		activeAskUserPrompt = nil
		// Replace the interactive control with the answered Q&A immediately.
		appendLocalAskUserQA(query: prompt.query, answer: label, error: nil, requestId: prompt.requestId)
		continuation.resume(returning: (index, label, String(index + 1), nil))
	}

	func submitAskUserCustomAnswer(_ rawInput: String) {
		guard let prompt = activeAskUserPrompt, let continuation = askUserContinuation else { return }
		let trimmed = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		askUserContinuation = nil
		activeAskUserPrompt = nil
		appendLocalAskUserQA(query: prompt.query, answer: trimmed, error: nil, requestId: prompt.requestId)
		continuation.resume(returning: (-1, trimmed, trimmed, nil))
	}

	func cancelAskUserPrompt() {
		guard let prompt = activeAskUserPrompt, let continuation = askUserContinuation else { return }
		askUserContinuation = nil
		activeAskUserPrompt = nil
		appendLocalAskUserQA(query: prompt.query, answer: "", error: "Cancelled", requestId: prompt.requestId)
		continuation.resume(returning: (-1, "", "", "Cancelled"))
	}

	private func appendLocalAskUserQA(query: String, answer: String, error: String?, requestId: String) {
		transcript.append(
			.askUserQA(
				blockKey: "local-ask-\(requestId)",
				query: query,
				answer: answer,
				error: error,
			),
		)
	}

	private func reloadTranscriptFromServer() async {
		guard let sessionId else { return }
		do {
			let detail = try await client.fetchSession(id: sessionId)
			transcript = ChatAttachmentDrafting.rehydrateLocalPreviews(
				in: detail.transcript,
				previewsByTranscriptText: localAttachmentPreviewsByTranscriptText,
			)
			sessionPersonaImageUrl = detail.personaImageUrl
			contextWindow = mergeContextWindowPayload(current: contextWindow, incoming: detail.contextWindow)
		} catch {
			// Keep the locally streamed transcript if refresh fails.
		}
	}

	// MARK: - Session identity bridge

	private func sessionIdentityState() -> ChatSessionIdentityState {
		ChatSessionIdentityState(
			sessionId: sessionId,
			sessionName: sessionName,
			transcript: transcript,
			integration: integration,
			integrationIconUrl: integrationIconUrl,
			externalKey: externalKey,
			sessionPersonaImageUrl: sessionPersonaImageUrl,
			streamingAssistant: streamingAssistant,
			turnWorkDurations: turnWorkDurations,
			contextWindow: contextWindow,
			promptText: promptText,
			activityLine: activityLine,
		)
	}

	private func applySessionIdentityState(_ state: ChatSessionIdentityState) {
		sessionId = state.sessionId
		sessionName = state.sessionName
		transcript = state.transcript
		integration = state.integration
		integrationIconUrl = state.integrationIconUrl
		externalKey = state.externalKey
		sessionPersonaImageUrl = state.sessionPersonaImageUrl
		streamingAssistant = state.streamingAssistant
		turnWorkDurations = state.turnWorkDurations
		contextWindow = state.contextWindow
		promptText = state.promptText
		activityLine = state.activityLine
	}

	// MARK: - Turn engine bridge

	/// Snapshot of fields the turn engine may rewrite during SSE streaming.
	private func turnMutationState() -> ChatTurnMutationState {
		ChatTurnMutationState(
			transcript: transcript,
			streamingAssistant: streamingAssistant,
			activityLine: activityLine,
			assistantHeader: assistantHeader,
			assistantBuffer: assistantBuffer,
			sawToolCallThisTurn: sawToolCallThisTurn,
			personaFallback: status?.persona ?? "Assistant",
		)
	}

	private func applyTurnMutationState(_ state: ChatTurnMutationState) {
		// Avoid rewriting `transcript` on pure assistant text-deltas (same rows).
		// Reassignment notifies @Observable observers and forced TranscriptView to
		// re-fingerprint / re-group large histories on every token.
		if state.transcript.count != transcript.count
			|| state.transcript.last?.id != transcript.last?.id
			|| state.transcript.first?.id != transcript.first?.id
			|| !transcriptRowStampsMatch(state.transcript)
		{
			transcript = state.transcript
		}
		streamingAssistant = state.streamingAssistant
		activityLine = state.activityLine
		assistantHeader = state.assistantHeader
		assistantBuffer = state.assistantBuffer
		sawToolCallThisTurn = state.sawToolCallThisTurn
	}

	/// True when each row's lightweight stamp matches (ids + body lengths, not full text).
	private func transcriptRowStampsMatch(_ other: [TranscriptEntry]) -> Bool {
		guard other.count == transcript.count else { return false }
		for index in transcript.indices {
			if transcript[index].id != other[index].id { return false }
			if transcript[index].contentStamp != other[index].contentStamp { return false }
		}
		return true
	}

	private func applyTurnEvent(_ event: ChatEventPayload) {
		var state = turnMutationState()
		ChatTurnEngine.apply(event: event, state: &state)
		applyTurnMutationState(state)
	}

	private func commitTurnAssistantSegment(id: String, interim: Bool) {
		var state = turnMutationState()
		ChatTurnEngine.commitAssistantSegment(id: id, interim: interim, state: &state)
		applyTurnMutationState(state)
	}
}
