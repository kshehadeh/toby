import AppKit
import Foundation
import Observation
import UniformTypeIdentifiers

func makeRecordingChatPrompt(name: String, dateText: String, hourText: String) -> String {
	let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
	let resolvedName = trimmedName.isEmpty ? "Recording" : trimmedName
	return "Summarize the transcript of the recording named \"\(resolvedName)\" on \"\(dateText)\" at \"\(hourText)\" oclock."
}

func mergeContextWindowPayload(
	current: ContextWindowPayload?,
	incoming: ContextWindowPayload?,
) -> ContextWindowPayload? {
	guard let incoming else { return current }
	guard let current else { return incoming }
	if current.supported,
		incoming.supported,
		current.fillPercentage != nil,
		incoming.fillPercentage == nil
	{
		return ContextWindowPayload(
			supported: true,
			contextWindowTokens: incoming.contextWindowTokens ?? current.contextWindowTokens,
			fillPercentage: current.fillPercentage,
			unavailableReason: nil,
		)
	}
	return incoming
}

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
		listenStatus?.isActive == true
	}

	var isRecordButtonDisabled: Bool {
		status == nil || isListenRequestInFlight
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

	private let client = TobyClient()
	private let nativeAudioClient = NativeAudioClient()
	private var assistantHeader = ""
	private var assistantBuffer = ""
	private var sawToolCallThisTurn = false
	private var activeTurnStartedAt: Date?
	private var activeTurnUserIndex: Int?
	private var askUserContinuation: CheckedContinuation<(selectedIndex: Int, selectedLabel: String, rawInput: String, error: String?), Never>?
	@ObservationIgnored
	nonisolated(unsafe) private var externalSessionRefreshTask: Task<Void, Never>?

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
			listenStatus = try? await nativeAudioClient.status()
			await refreshDaemonStatus()
			await refreshSessions()
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

	func refreshStatus() async {
		do {
			status = try await client.fetchStatus()
			listenStatus = try? await nativeAudioClient.status()
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
			listenStatus = try? await nativeAudioClient.status()
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
			sessionName = detail.name
			integrationIconUrl = detail.integrationIconUrl
			transcript = detail.transcript
			activityLine = "Ready"
		} catch {
			// Keep existing transcript on refresh failure.
		}
	}

	func toggleRecording() async {
		guard !isListenRequestInFlight else { return }
		if isRecordingActive {
			await stopActiveRecording()
		} else {
			await startRecording()
		}
	}

	func stopActiveRecording() async {
		guard !isListenRequestInFlight, isRecordingActive else { return }
		await stopRecording()
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
		guard sessionId != id || transcript.isEmpty else { return }
		isSelectingSession = true
		defer { isSelectingSession = false }
		do {
			let detail = try await client.fetchSession(id: id)
			sessionId = detail.id
			sessionName = detail.name
			transcript = detail.transcript
			integration = detail.integration
			integrationIconUrl = detail.integrationIconUrl
			externalKey = detail.externalKey
			sessionPersonaImageUrl = detail.personaImageUrl
			streamingAssistant = nil
			turnWorkDurations = [:]
			contextWindow = detail.contextWindow
			promptText = ""
			activityLine = "Ready"
			startExternalSessionRefreshLoop()
		} catch {
			showErrorToast(error.localizedDescription)
		}
	}

	func startNewSession() async {
		guard !isLoading else { return }
		sessionId = nil
		sessionName = "New chat"
		transcript = []
		integration = nil
		integrationIconUrl = nil
		externalKey = nil
		sessionPersonaImageUrl = nil
		streamingAssistant = nil
		turnWorkDurations = [:]
		contextWindow = nil
		activityLine = "Ready"
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
			toast = AppToastState(
				style: .error,
				title: "No transcription model configured",
				message: "Audio will be saved without a transcript. Choose a transcription provider to enable transcripts.",
				action: .openSettings(navKey: "transcription")
			)
		}
		do {
			listenStatus = try await nativeAudioClient.start()
			activityLine = "Recording audio"
		} catch {
			showRecordingError(error.localizedDescription)
			activityLine = "Error"
			listenStatus = try? await nativeAudioClient.status()
		}
	}

	private func stopRecording() async {
		isListenRequestInFlight = true
		defer { isListenRequestInFlight = false }
		recordingProcessing = RecordingProcessingState(stage: .generatingAudio)
		toast = recordingProcessing?.toastState()
		activityLine = "Generating final audio…"

		do {
			let result = try await nativeAudioClient.stop()
			listenStatus = result.asStatus
			guard let id = result.id else {
				activityLine = "Recording saved"
				showRecordingCompletionToast(recordingId: result.id, errors: result.errors)
				recordingProcessing = nil
				return
			}

			if let errors = result.errors, let firstError = errors.first?.trimmingCharacters(in: .whitespacesAndNewlines), !firstError.isEmpty {
				recordingProcessing = RecordingProcessingState(
					recordingId: id,
					stage: .failed,
					message: firstError,
				)
				toast = recordingProcessing?.toastState()
				activityLine = "Recording saved"
				return
			}

			recordingProcessing = RecordingProcessingState(
				recordingId: id,
				stage: .preparingTranscription,
			)
			toast = recordingProcessing?.toastState()
			activityLine = "Transcribing recording…"

			do {
				_ = try await client.streamTranscribeRecording(id: id) { message in
					Task { @MainActor in
						guard self.recordingProcessing?.recordingId == id,
							self.recordingProcessing?.isActive == true else { return }
						self.recordingProcessing?.stage = .transcribing
						self.recordingProcessing?.message = message
						self.toast = self.recordingProcessing?.toastState()
						self.activityLine = message
					}
				}
				recordingProcessing = RecordingProcessingState(
					recordingId: id,
					stage: .complete,
					message: "Your recording is ready.",
				)
				toast = recordingProcessing?.toastState()
				activityLine = "Recording transcribed"
			} catch {
				recordingProcessing = RecordingProcessingState(
					recordingId: id,
					stage: .failed,
					message: "Recording saved, but transcription failed: \(error.localizedDescription)",
				)
				toast = recordingProcessing?.toastState()
				activityLine = "Recording saved"
			}
		} catch {
			showRecordingError(error.localizedDescription)
			activityLine = "Error"
			listenStatus = try? await nativeAudioClient.status()
			recordingProcessing = nil
		}
	}

	private func showRecordingError(_ message: String) {
		toast = AppToastState(
			style: .error,
			title: "Recording failed",
			message: message,
		)
	}

	private func showRecordingCompletionToast(recordingId: String?, errors: [String]?) {
		let message = errors?.first?.trimmingCharacters(in: .whitespacesAndNewlines)
		if let message, !message.isEmpty {
			toast = AppToastState(
				style: .error,
				title: "Recording issue",
				message: message,
			)
			return
		}
		let action: AppToastAction? = recordingId.map { .openRecording(id: $0) }
		toast = AppToastState(
			style: .success,
			title: "Recording transcribed",
			message: "Your recording is ready.",
			action: action
		)
	}

	private func createSessionAndSubmit() async {
		do {
			let created = try await client.createSession()
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
		let userText = userTranscriptText(text: text, attachments: attachments)
		let transcriptAttachments = transcriptAttachments(from: attachments)
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
				self.apply(event: event)
			}, onAskUser: { [weak self] prompt in
				guard let self else { return (-1, "", "", "Prompt dismissed") }
				return await self.promptForAskUser(prompt)
			})
			if !assistantBuffer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				commitAssistantSegment(id: UUID().uuidString, interim: false)
			}
			let reply = done.text.trimmingCharacters(in: .whitespacesAndNewlines)
			if !reply.isEmpty && !hasAssistantReplyBody(reply, sinceIndex: userTurnStartIndex) {
				assistantHeader = status?.persona ?? "Assistant"
				assistantBuffer = reply
				commitAssistantSegment(id: UUID().uuidString, interim: false)
			}
			if let nextSessionName = done.sessionName?.trimmingCharacters(
				in: .whitespacesAndNewlines,
			), !nextSessionName.isEmpty {
				sessionName = nextSessionName
			}
			contextWindow = done.contextWindow
			await reloadTranscriptFromServer(clearTurnDurationForIndex: userTurnStartIndex)
			streamingAssistant = nil
			activityLine = "Ready"
			clearAttachments()
			await refreshSessions()
		} catch {
			if isCancelling {
				if !assistantBuffer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
					commitAssistantSegment(id: UUID().uuidString, interim: false)
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

		isLoading = false
		isCancelling = false
		activeTurnId = nil
		recordTurnDuration()
	}

	func addAttachmentFiles(_ urls: [URL]) {
		guard canAttachFiles else {
			showErrorToast(attachmentUnavailableReason, title: "Attachments unavailable")
			return
		}
		let capability = attachmentCapability
		var next = pendingAttachments
		for url in urls {
			if let maxFiles = capability?.maxFiles, next.count >= maxFiles {
				showErrorToast("Too many attachments. Maximum is \(maxFiles).", title: "Attachment error")
				break
			}
			do {
				let attachment = try makeAttachmentDraft(from: url)
				if let maxBytes = capability?.maxBytesPerFile, attachment.byteSize > maxBytes {
					showErrorToast("\(attachment.filename) is too large.", title: "Attachment error")
					continue
				}
				let totalBytes = next.reduce(0) { $0 + $1.byteSize } + attachment.byteSize
				if let maxTotal = capability?.maxTotalBytes, totalBytes > maxTotal {
					showErrorToast("Attachments are too large.", title: "Attachment error")
					continue
				}
				if let accepted = capability?.acceptedMediaTypes, !accepted.isEmpty, !accepted.contains(attachment.mediaType) {
					showErrorToast("Unsupported attachment type: \(attachment.mediaType).", title: "Attachment error")
					continue
				}
				next.append(attachment)
			} catch {
				showErrorToast(error.localizedDescription, title: "Attachment error")
			}
		}
		pendingAttachments = next
	}

	func removeAttachment(id: UUID) {
		pendingAttachments.removeAll { $0.id == id }
	}

	func clearAttachments() {
		pendingAttachments = []
	}

	private func makeAttachmentDraft(from url: URL) throws -> ChatAttachmentDraft {
		let didAccess = url.startAccessingSecurityScopedResource()
		defer {
			if didAccess {
				url.stopAccessingSecurityScopedResource()
			}
		}
		let data = try Data(contentsOf: url)
		let mediaType = mediaTypeForAttachment(url: url)
		return ChatAttachmentDraft(
			filename: url.lastPathComponent,
			mediaType: mediaType,
			dataBase64: data.base64EncodedString(),
			byteSize: data.count
		)
	}

	private func mediaTypeForAttachment(url: URL) -> String {
		if let type = UTType(filenameExtension: url.pathExtension),
			let mimeType = type.preferredMIMEType
		{
			switch mimeType {
			case "application/x-javascript":
				return "text/javascript"
			default:
				return mimeType
			}
		}
		switch url.pathExtension.lowercased() {
		case "md", "markdown": return "text/markdown"
		case "ts", "tsx": return "application/typescript"
		case "js", "jsx", "mjs", "cjs": return "text/javascript"
		case "json": return "application/json"
		case "csv": return "text/csv"
		case "xml": return "application/xml"
		case "html", "htm": return "text/html"
		case "css": return "text/css"
		case "rtf": return "application/rtf"
		default: return "text/plain"
		}
	}

	private func userTranscriptText(text: String, attachments: [ChatAttachmentDraft]) -> String {
		guard !attachments.isEmpty else { return text }
		let names = attachments.map { "\($0.filename) (\($0.mediaType), \($0.byteSize) bytes)" }
			.joined(separator: ", ")
		if text.isEmpty {
			return "Attachments: \(names)"
		}
		return "\(text)\n\nAttachments: \(names)"
	}

	private func transcriptAttachments(from attachments: [ChatAttachmentDraft]) -> [ChatTranscriptAttachment] {
		attachments.map {
			ChatTranscriptAttachment(
				id: $0.id,
				filename: $0.filename,
				mediaType: $0.mediaType,
				dataBase64: $0.dataBase64,
				byteSize: $0.byteSize
			)
		}
	}

	private func rehydrateLocalAttachmentPreviews(in entries: [TranscriptEntry]) -> [TranscriptEntry] {
		entries.map { entry in
			guard case .user(let text, let attachments) = entry, attachments.isEmpty,
				let localAttachments = localAttachmentPreviewsByTranscriptText[text]
			else {
				return entry
			}
			return .user(text: text, attachments: localAttachments)
		}
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

	private func reloadTranscriptFromServer(clearTurnDurationForIndex userIndex: Int?) async {
		guard let sessionId else { return }
		do {
			let detail = try await client.fetchSession(id: sessionId)
			transcript = rehydrateLocalAttachmentPreviews(in: detail.transcript)
			sessionPersonaImageUrl = detail.personaImageUrl
			contextWindow = mergeContextWindowPayload(current: contextWindow, incoming: detail.contextWindow)
			if let userIndex {
				turnWorkDurations.removeValue(forKey: userIndex)
			}
		} catch {
			// Keep the locally streamed transcript if refresh fails.
		}
	}

	private func apply(event: ChatEventPayload) {
		switch event.type {
		case "lifecycle_start":
			appendProcessingRow(
				id: event.id ?? UUID().uuidString,
				header: event.header ?? "Working",
				body: "Thinking",
				variant: "lifecycle",
			)
			if let header = event.header {
				activityLine = header
			}
		case "lifecycle_end":
			updateProcessingRow(
				id: event.id,
				body: event.detail ?? "Done.",
			)
		case "lifecycle_append":
			appendProcessingDetail(id: event.id, line: event.line)
		case "lifecycle_set":
			updateProcessingRow(id: event.id, body: event.line ?? "")
		case "assistant_segment_start":
			assistantHeader = event.header ?? status?.persona ?? "Assistant"
			assistantBuffer = ""
			streamingAssistant = StreamingAssistantState(
				header: assistantHeader,
				text: "",
				inWorkArea: !sawToolCallThisTurn,
			)
			activityLine = "Responding…"
		case "assistant_text_delta":
			assistantBuffer += event.delta ?? ""
			streamingAssistant = StreamingAssistantState(
				header: assistantHeader,
				text: assistantBuffer,
				inWorkArea: !sawToolCallThisTurn,
			)
		case "assistant_segment_end":
			commitAssistantSegment(
				id: event.id ?? UUID().uuidString,
				interim: event.interim == true,
			)
		case "tool_call_start":
			// askUser is rendered as an inline transcript control, not a tool step.
			if event.toolName == "askUser" {
				activityLine = "Waiting for your choice…"
				break
			}
			sawToolCallThisTurn = true
			if let toolName = event.toolName {
				let args = event.args?.value as? [String: Any]
				let header = ToolDisplayLabels.formatToolCallHeader(
					toolName: toolName,
					args: args,
					integrationLabel: event.integrationLabel,
				)
				appendToolRow(
					id: event.blockKey ?? event.id ?? UUID().uuidString,
					header: header,
					body: "Running…",
					toolName: toolName,
					integrationLabel: event.integrationLabel,
					cacheHit: nil,
					durationMs: nil,
				)
				activityLine = "Running \(ToolDisplayLabels.displayLabel(toolName))…"
			}
		case "tool_call_complete":
			if event.toolName == "askUser" {
				appendAskUserQA(from: event)
				activityLine = "Thinking…"
				break
			}
			if let toolName = event.toolName {
				let args = event.args?.value as? [String: Any]
				let errorString: String?
				if let error = event.error?.value {
					if error is NSNull {
						errorString = nil
					} else if let str = error as? String {
						errorString = str
					} else {
						errorString = String(describing: error)
					}
				} else {
					errorString = nil
				}
				let body: String
				if event.cacheHit == true {
					body = "Done. Cached result."
				} else {
					body = ToolDisplayLabels.formatToolOutput(
						toolName: toolName,
						args: args,
						result: event.result?.value,
						error: errorString,
					)
				}
				let fullBody: String?
				if event.cacheHit == true {
					fullBody = nil
				} else {
					let full = ToolDisplayLabels.formatToolOutputFull(
						toolName: toolName,
						args: args,
						result: event.result?.value,
						error: errorString,
					)
					fullBody = full != body ? full : nil
				}
				let header = ToolDisplayLabels.formatToolCallHeader(
					toolName: toolName,
					args: args,
					integrationLabel: event.integrationLabel,
				)
				upsertToolRow(
					id: event.blockKey ?? event.id ?? UUID().uuidString,
					header: header,
					body: body,
					fullBody: fullBody,
					toolName: toolName,
					integrationLabel: event.integrationLabel,
					cacheHit: event.cacheHit,
					durationMs: event.durationMs,
				)
			}
			activityLine = "Thinking…"
		case "prep_start":
			if let header = event.header {
				activityLine = header
			}
		case "transcript_notice":
			if let text = event.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
				transcript.append(.notice(text: text, tone: event.tone))
			}
		default:
			break
		}
	}

	private func appendProcessingRow(
		id: String,
		header: String,
		body: String,
		variant: String,
	) {
		transcript.append(
			.boxedStep(
				BoxedStepPayload(
					id: id,
					seq: transcript.count + 1,
					variant: variant,
					header: header,
					body: body,
					toolName: nil,
					integrationLabel: nil,
					cacheHit: nil,
					durationMs: nil,
					toolRuns: nil,
					fullBody: nil,
				),
			),
		)
	}

	private func updateProcessingRow(id: String?, body: String) {
		guard let id else { return }
		replaceBoxedStep(id: id) { current in
			BoxedStepPayload(
				id: current.id,
				seq: current.seq,
				variant: current.variant,
				header: current.header,
				body: body,
				toolName: current.toolName,
				integrationLabel: current.integrationLabel,
				cacheHit: current.cacheHit,
				durationMs: current.durationMs,
				toolRuns: current.toolRuns,
				fullBody: current.fullBody,
			)
		}
	}

	private func appendProcessingDetail(id: String?, line: String?) {
		guard let id, let line, !line.isEmpty else { return }
		replaceBoxedStep(id: id) { current in
			let nextBody = current.body.isEmpty ? line : "\(current.body)\n\(line)"
			return BoxedStepPayload(
				id: current.id,
				seq: current.seq,
				variant: current.variant,
				header: current.header,
				body: nextBody,
				toolName: current.toolName,
				integrationLabel: current.integrationLabel,
				cacheHit: current.cacheHit,
				durationMs: current.durationMs,
				toolRuns: current.toolRuns,
				fullBody: current.fullBody,
			)
		}
	}

	private func appendToolRow(
		id: String,
		header: String,
		body: String,
		fullBody: String? = nil,
		toolName: String,
		integrationLabel: String?,
		cacheHit: Bool?,
		durationMs: Int?,
	) {
		transcript.append(
			.boxedStep(
				BoxedStepPayload(
					id: id,
					seq: transcript.count + 1,
					variant: "tool",
					header: header,
					body: body,
					toolName: toolName,
					integrationLabel: integrationLabel,
					cacheHit: cacheHit,
					durationMs: durationMs,
					toolRuns: nil,
					fullBody: fullBody,
				),
			),
		)
	}

	/// Server-side askUser tool completion. Prefer upgrading a local optimistic
	/// Q&A row when one was already inserted on submit, so the control does not
	/// flash empty and then double-render.
	private func appendAskUserQA(from event: ChatEventPayload) {
		let args = event.args?.value as? [String: Any]
		var query = (args?["query"] as? String) ?? ""
		let blockKey = event.blockKey ?? event.id ?? UUID().uuidString

		let errorString: String?
		if let error = event.error?.value {
			if error is NSNull {
				errorString = nil
			} else if let str = error as? String {
				errorString = str
			} else {
				errorString = String(describing: error)
			}
		} else {
			errorString = nil
		}

		let answer: String
		let resolvedError: String?
		if let errorString, !errorString.isEmpty {
			answer = ""
			resolvedError = errorString
		} else if let result = event.result?.value as? [String: Any],
			let resultError = result["error"] as? String,
			!resultError.isEmpty
		{
			answer = ""
			resolvedError = resultError
		} else {
			let result = event.result?.value as? [String: Any]
			answer = ((result?["selectedLabel"] as? String) ?? "")
				.trimmingCharacters(in: .whitespacesAndNewlines)
			resolvedError = nil
		}

		if let index = transcript.lastIndex(where: { entry in
			if case .askUserQA(let key, let existingQuery, _, _) = entry {
				return existingQuery == query || key.hasPrefix("local-ask-")
			}
			return false
		}) {
			if query.isEmpty, case .askUserQA(_, let existingQuery, _, _) = transcript[index] {
				query = existingQuery
			}
			transcript[index] = .askUserQA(
				blockKey: blockKey,
				query: query,
				answer: answer,
				error: resolvedError,
			)
			return
		}

		transcript.append(
			.askUserQA(blockKey: blockKey, query: query, answer: answer, error: resolvedError),
		)
	}

	private func upsertToolRow(
		id: String,
		header: String,
		body: String,
		fullBody: String? = nil,
		toolName: String,
		integrationLabel: String?,
		cacheHit: Bool?,
		durationMs: Int?,
	) {
		let replaced = replaceBoxedStep(id: id) { current in
			BoxedStepPayload(
				id: current.id,
				seq: current.seq,
				variant: "tool",
				header: header,
				body: body,
				toolName: toolName,
				integrationLabel: integrationLabel,
				cacheHit: cacheHit,
				durationMs: durationMs,
				toolRuns: nil,
				fullBody: fullBody,
			)
		}
		if !replaced {
			appendToolRow(
				id: id,
				header: header,
				body: body,
				fullBody: fullBody,
				toolName: toolName,
				integrationLabel: integrationLabel,
				cacheHit: cacheHit,
				durationMs: durationMs,
			)
		}
	}

	@discardableResult
	private func replaceBoxedStep(
		id: String,
		transform: (BoxedStepPayload) -> BoxedStepPayload,
	) -> Bool {
		guard let index = transcript.lastIndex(where: { entry in
			if case .boxedStep(let payload) = entry {
				return payload.id == id
			}
			return false
		}) else {
			return false
		}
		if case .boxedStep(let payload) = transcript[index] {
			transcript[index] = .boxedStep(transform(payload))
			return true
		}
		return false
	}

	private func commitAssistantSegment(id: String, interim: Bool) {
		let body = assistantBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !body.isEmpty else { return }
		transcript.append(
			.boxedStep(
				BoxedStepPayload(
					id: id,
					seq: transcript.count + 1,
					variant: interim ? "assistant_interim" : "assistant",
					header: assistantHeader,
					body: body,
					toolName: nil,
					integrationLabel: nil,
					cacheHit: nil,
					durationMs: nil,
					toolRuns: nil,
					fullBody: nil,
				),
			),
		)
		assistantBuffer = ""
		streamingAssistant = nil
	}

	private func hasAssistantReplyBody(_ body: String, sinceIndex userIndex: Int) -> Bool {
		guard userIndex >= 0, userIndex < transcript.count else { return false }
		let normalized = body.trimmingCharacters(in: .whitespacesAndNewlines)
		for entry in transcript[(userIndex + 1)...] {
			if case .boxedStep(let payload) = entry, payload.variant == "assistant" {
				if payload.body.trimmingCharacters(in: .whitespacesAndNewlines) == normalized {
					return true
				}
			}
			if case .assistant(let text) = entry {
				if text.trimmingCharacters(in: .whitespacesAndNewlines) == normalized {
					return true
				}
			}
		}
		return false
	}
}
