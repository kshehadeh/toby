import Foundation
@testable import TobyApp

/// In-memory daemon stub for `ChatStore` tests (Phase 7 DI).
@MainActor
final class MockChatClient: ChatClientable {
	var baseURL: URL = URL(string: "http://127.0.0.1:9")!

	var status: AppStatus?
	var daemonStatus: DaemonStatus?
	var sessions: [SessionSummary] = []
	var personas: [PersonaOption] = []
	var sessionDetails: [String: SessionDetail] = [:]
	var createSessionResponse: CreateSessionResponse?
	var createIssueResponse: CreateIssueResponse?
	var turnDone: TurnDonePayload?
	var streamEvents: [ChatEventPayload] = []

	var listSessionsLimit: Int?
	var fetchSessionIds: [String] = []
	var deletedSessionIds: [String] = []
	var cancelTurnCalls: [(sessionId: String, turnId: String)] = []
	var streamTurnCalls = 0
	var saveAttachmentsToProjectValues: [Bool] = []
	var createSessionCalls = 0
	var lastCreateSessionPersona: String?
	var restartDaemonCalls = 0
	var fetchStatusCalls = 0

	var error: Error?
	var streamTurnError: Error?
	var deleteError: Error?

	func fetchStatus() async throws -> AppStatus {
		fetchStatusCalls += 1
		if let error { throw error }
		guard let status else { throw TobyClientError.invalidResponse }
		return status
	}

	func fetchDaemonStatus() async throws -> DaemonStatus {
		if let error { throw error }
		guard let daemonStatus else { throw TobyClientError.invalidResponse }
		return daemonStatus
	}

	func restartDaemon(onProgress: DaemonBootstrapProgress?) async throws {
		restartDaemonCalls += 1
		onProgress?("Restarting…")
		if let error { throw error }
	}

	func listSessions(limit: Int) async throws -> [SessionSummary] {
		listSessionsLimit = limit
		if let error { throw error }
		return sessions
	}

	func listPersonas() async throws -> [PersonaOption] {
		if let error { throw error }
		return personas
	}

	func fetchSession(id: String) async throws -> SessionDetail {
		fetchSessionIds.append(id)
		if let error { throw error }
		guard let detail = sessionDetails[id] else { throw TobyClientError.invalidResponse }
		return detail
	}

	func createSession(persona: String?) async throws -> CreateSessionResponse {
		createSessionCalls += 1
		lastCreateSessionPersona = persona
		if let error { throw error }
		guard let createSessionResponse else { throw TobyClientError.invalidResponse }
		return createSessionResponse
	}

	func deleteSession(id: String) async throws {
		deletedSessionIds.append(id)
		if let deleteError { throw deleteError }
		if let error { throw error }
		sessions.removeAll { $0.id == id }
		sessionDetails[id] = nil
	}

	func updateRecordingChatSession(id: String, chatSessionId: String?) async throws
		-> ListenRecordingDetail
	{
		if let error { throw error }
		throw TobyClientError.invalidResponse
	}

	func streamTranscribeRecording(
		id: String,
		onStatus: @escaping (String) -> Void,
	) async throws -> ListenRecordingDetail {
		if let error { throw error }
		throw TobyClientError.invalidResponse
	}

	func streamTurn(
		sessionId: String,
		text: String,
		attachments: [ChatAttachmentDraft],
		saveAttachmentsToProject: Bool,
		clientTurnId: String?,
		onEvent: @escaping (ChatEventPayload) -> Void,
		onAskUser: ((AskUserPromptPayload) async -> (
			selectedIndex: Int,
			selectedLabel: String,
			rawInput: String,
			error: String?
		))?,
	) async throws -> TurnDonePayload {
		streamTurnCalls += 1
		saveAttachmentsToProjectValues.append(saveAttachmentsToProject)
		if let streamTurnError { throw streamTurnError }
		if let error { throw error }
		for event in streamEvents {
			onEvent(event)
		}
		guard let turnDone else {
			return TurnDonePayload(
				turnId: clientTurnId,
				text: "",
				appliedActions: nil,
				sessionName: nil,
				usage: nil,
				contextWindow: nil,
			)
		}
		return turnDone
	}

	func cancelTurn(sessionId: String, turnId: String) async {
		cancelTurnCalls.append((sessionId, turnId))
	}

	func createIssue(type: String, details: String) async throws -> CreateIssueResponse {
		if let error { throw error }
		guard let createIssueResponse else { throw TobyClientError.invalidResponse }
		return createIssueResponse
	}
}

@MainActor
final class MockNativeAudioClient: NativeAudioClientable {
	var statusResponse: ListenStatusResponse?
	var startResponse: ListenStatusResponse?
	var stopResponse: NativeAudioStopResponse?
	var error: Error?
	var startCalls = 0
	var stopCalls = 0
	var statusCalls = 0
	var waitForStop = false
	var stopGate: CheckedContinuation<Void, Never>?

	func resumeStop() {
		stopGate?.resume()
		stopGate = nil
	}

	func status() async throws -> ListenStatusResponse {
		statusCalls += 1
		if let error { throw error }
		guard let statusResponse else { throw NativeAudioClientError.unavailable }
		return statusResponse
	}

	func start(mic: Bool, system: Bool) async throws -> ListenStatusResponse {
		startCalls += 1
		if let error { throw error }
		guard let startResponse else { throw NativeAudioClientError.unavailable }
		return startResponse
	}

	func stop() async throws -> NativeAudioStopResponse {
		stopCalls += 1
		if waitForStop {
			await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
				stopGate = continuation
			}
		}
		if let error { throw error }
		guard let stopResponse else { throw NativeAudioClientError.unavailable }
		return stopResponse
	}
}
