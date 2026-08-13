import Foundation

/// Daemon HTTP surface used by `ChatStore` (sessions, turns, status, issues, listen).
@MainActor
protocol ChatClientable {
	var baseURL: URL { get }

	func fetchStatus() async throws -> AppStatus
	func fetchDaemonStatus() async throws -> DaemonStatus
	func restartDaemon(onProgress: DaemonBootstrapProgress?) async throws
	func listSessions(limit: Int) async throws -> [SessionSummary]
	func listPersonas() async throws -> [PersonaOption]
	func fetchSession(id: String) async throws -> SessionDetail
	func createSession(persona: String?) async throws -> CreateSessionResponse
	func deleteSession(id: String) async throws
	func updateRecordingChatSession(id: String, chatSessionId: String?) async throws
		-> ListenRecordingDetail
	func streamTranscribeRecording(
		id: String,
		onStatus: @escaping (String) -> Void,
	) async throws -> ListenRecordingDetail
	func streamTurn(
		sessionId: String,
		text: String,
		attachments: [ChatAttachmentDraft],
		clientTurnId: String?,
		onEvent: @escaping (ChatEventPayload) -> Void,
		onAskUser: ((AskUserPromptPayload) async -> (
			selectedIndex: Int,
			selectedLabel: String,
			rawInput: String,
			error: String?
		))?,
	) async throws -> TurnDonePayload
	func cancelTurn(sessionId: String, turnId: String) async
	func createIssue(type: String, details: String) async throws -> CreateIssueResponse
}

extension TobyClient: ChatClientable {}

/// Native audio localhost API used for listen start/stop/status.
@MainActor
protocol NativeAudioClientable {
	func status() async throws -> ListenStatusResponse
	func start(mic: Bool, system: Bool) async throws -> ListenStatusResponse
	func stop() async throws -> NativeAudioStopResponse
}

extension NativeAudioClient: NativeAudioClientable {}
