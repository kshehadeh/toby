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
	var promptFocusRequestId = UUID()
	var isLoading = false
	var isSelectingSession = false
	var listenStatus: ListenStatusResponse?
	var isListenRequestInFlight = false
	var errorMessage: String?
	var toast: AppToastState?
	var turnWorkDurations: [Int: TimeInterval] = [:]
	var activeAskUserPrompt: ActiveAskUserPrompt?
	let serverEventLogPath = ServerEventLog.path
	var integration: String?
	var externalKey: String?

	var isExternalSession: Bool {
		integration != nil && externalKey != nil
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
		do {
			activityLine = "Checking server…"
			try await DaemonBootstrap.ensureServerAvailable(baseURL: client.baseURL)
			activityLine = "Connecting…"
			status = try await client.fetchStatus()
			listenStatus = try? await nativeAudioClient.status()
			await refreshDaemonStatus()
			await refreshSessions()
			if let mostRecent = sessions.first {
				await selectSession(id: mostRecent.id)
			} else {
				await startNewSession()
			}
			errorMessage = nil
		} catch {
			errorMessage = error.localizedDescription
			activityLine = "Daemon unavailable"
		}
	}

	func refreshSessions() async {
		isSessionsLoading = true
		defer { isSessionsLoading = false }
		do {
			sessions = try await client.listSessions(limit: 50)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func refreshStatus() async {
		do {
			status = try await client.fetchStatus()
			listenStatus = try? await nativeAudioClient.status()
			errorMessage = nil
		} catch {
			errorMessage = error.localizedDescription
		}
		await refreshDaemonStatus()
	}

	func refreshDaemonStatus() async {
		do {
			daemonStatus = try await client.fetchDaemonStatus()
		} catch {
			daemonStatus = nil
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
			transcript = detail.transcript
			activityLine = "Ready"
		} catch {
			// Keep existing transcript on refresh failure.
		}
	}

	func toggleRecording() async {
		guard !isListenRequestInFlight else { return }
		if isRecordingActive {
			await stopRecording()
		} else {
			await startRecording()
		}
	}

	func dismissError() {
		errorMessage = nil
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
					message: url,
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
			externalKey = detail.externalKey
			streamingAssistant = nil
			turnWorkDurations = [:]
			promptText = ""
			errorMessage = nil
			activityLine = "Ready"
			startExternalSessionRefreshLoop()
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func startNewSession() async {
		guard !isLoading else { return }
		if hasCleanCurrentSession {
			focusPrompt()
			return
		}
		do {
			let created = try await client.createSession()
			sessionId = created.id
			sessionName = created.name
			transcript = []
			integration = nil
			externalKey = nil
			streamingAssistant = nil
			turnWorkDurations = [:]
			errorMessage = nil
			activityLine = "Ready"
			stopExternalSessionRefreshLoop()
			await refreshSessions()
		} catch {
			errorMessage = error.localizedDescription
		}
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
				if let nextSession = sessions.first {
					await selectSession(id: nextSession.id)
				} else {
					await startNewSession()
				}
			}
			errorMessage = nil
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	private func startRecording() async {
		isListenRequestInFlight = true
		defer { isListenRequestInFlight = false }
		do {
			listenStatus = try await nativeAudioClient.start()
			activityLine = "Recording audio"
			errorMessage = nil
		} catch {
			showRecordingError(error.localizedDescription)
			activityLine = "Error"
			listenStatus = try? await nativeAudioClient.status()
		}
	}

	private func stopRecording() async {
		isListenRequestInFlight = true
		defer { isListenRequestInFlight = false }
		do {
			let result = try await nativeAudioClient.stop()
			listenStatus = result.asStatus
			if let id = result.id {
				do {
					_ = try await client.transcribeRecording(id: id)
					errorMessage = nil
					activityLine = "Recording transcribed"
					showRecordingCompletionToast(recordingId: id, errors: result.errors)
				} catch {
					showRecordingError("Recording saved, but transcription failed: \(error.localizedDescription)")
					activityLine = "Recording saved"
				}
			} else {
				errorMessage = nil
				activityLine = "Recording saved"
				showRecordingCompletionToast(recordingId: result.id, errors: result.errors)
			}
		} catch {
			showRecordingError(error.localizedDescription)
			activityLine = "Error"
			listenStatus = try? await nativeAudioClient.status()
		}
	}

	private func showRecordingError(_ message: String) {
		errorMessage = message
		toast = AppToastState(
			style: .error,
			title: "Recording failed",
			message: message,
		)
	}

	private func showRecordingCompletionToast(recordingId: String?, errors: [String]?) {
		let message = errors?.first?.trimmingCharacters(in: .whitespacesAndNewlines)
		if let message, !message.isEmpty {
			errorMessage = message
			toast = AppToastState(
				style: .error,
				title: "Recording issue",
				message: message,
			)
			return
		}
		errorMessage = nil
		let action: AppToastAction? = recordingId.map { .openRecording(id: $0) }
		toast = AppToastState(
			style: .success,
			title: "Recording transcribed",
			message: "Your recording is ready.",
			action: action
		)
	}

	func submitPrompt() async {
		let text = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !text.isEmpty, !isLoading, let sessionId else { return }

		promptText = ""
		transcript.append(.user(text: text))
		let userTurnStartIndex = transcript.count - 1
		activeTurnStartedAt = Date()
		activeTurnUserIndex = userTurnStartIndex
		isLoading = true
		activityLine = "Thinking…"
		streamingAssistant = nil
		assistantHeader = ""
		assistantBuffer = ""
		sawToolCallThisTurn = false
		errorMessage = nil

		do {
			let done = try await client.streamTurn(sessionId: sessionId, text: text, onEvent: { event in
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
			await reloadTranscriptFromServer(clearTurnDurationForIndex: userTurnStartIndex)
			streamingAssistant = nil
			activityLine = "Ready"
			await refreshSessions()
		} catch {
			errorMessage = error.localizedDescription
			transcript.append(.error(text: error.localizedDescription))
			activityLine = "Error"
		}

		isLoading = false
		recordTurnDuration()
	}

	private func recordTurnDuration() {
		if let started = activeTurnStartedAt, let index = activeTurnUserIndex {
			turnWorkDurations[index] = Date().timeIntervalSince(started)
		}
		activeTurnStartedAt = nil
		activeTurnUserIndex = nil
	}

	private func promptForAskUser(_ payload: AskUserPromptPayload) async -> (selectedIndex: Int, selectedLabel: String, rawInput: String, error: String?) {
		await withCheckedContinuation { continuation in
			self.askUserContinuation = continuation
			self.activeAskUserPrompt = ActiveAskUserPrompt(
				id: payload.requestId,
				turnId: payload.turnId,
				requestId: payload.requestId,
				query: payload.query,
				options: payload.options
			)
		}
	}

	func submitAskUserOption(index: Int) {
		guard let prompt = activeAskUserPrompt, let continuation = askUserContinuation else { return }
		guard index >= 0, index < prompt.options.count else { return }
		let label = prompt.options[index]
		askUserContinuation = nil
		activeAskUserPrompt = nil
		continuation.resume(returning: (index, label, String(index + 1), nil))
	}

	func submitAskUserCustomAnswer(_ rawInput: String) {
		guard let continuation = askUserContinuation else { return }
		let trimmed = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		askUserContinuation = nil
		activeAskUserPrompt = nil
		continuation.resume(returning: (-1, trimmed, trimmed, nil))
	}

	func cancelAskUserPrompt() {
		guard let continuation = askUserContinuation else { return }
		askUserContinuation = nil
		activeAskUserPrompt = nil
		continuation.resume(returning: (-1, "", "", "Cancelled"))
	}

	private func reloadTranscriptFromServer(clearTurnDurationForIndex userIndex: Int?) async {
		guard let sessionId else { return }
		do {
			let detail = try await client.fetchSession(id: sessionId)
			transcript = detail.transcript
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
			sawToolCallThisTurn = true
			if let toolName = event.toolName {
				appendToolRow(
					id: event.blockKey ?? event.id ?? UUID().uuidString,
					header: event.integrationLabel.map { "\($0): \(toolName)" } ?? toolName,
					body: "Running…",
					toolName: toolName,
					integrationLabel: event.integrationLabel,
					cacheHit: nil,
					durationMs: nil,
				)
				activityLine = "Running \(toolName)…"
			}
		case "tool_call_complete":
			if let toolName = event.toolName {
				upsertToolRow(
					id: event.blockKey ?? event.id ?? UUID().uuidString,
					header: event.integrationLabel.map { "\($0): \(toolName)" } ?? toolName,
					body: event.cacheHit == true ? "Done. Cached result." : "Done.",
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
			)
		}
	}

	private func appendToolRow(
		id: String,
		header: String,
		body: String,
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
				),
			),
		)
	}

	private func upsertToolRow(
		id: String,
		header: String,
		body: String,
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
			)
		}
		if !replaced {
			appendToolRow(
				id: id,
				header: header,
				body: body,
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
