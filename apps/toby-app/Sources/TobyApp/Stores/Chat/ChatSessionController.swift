import Foundation

/// Identity + transcript fields rewritten when selecting or drafting a chat session.
struct ChatSessionIdentityState: Equatable {
	var sessionId: String?
	var sessionName: String
	var sessionProjectId: String?
	var transcript: [TranscriptEntry]
	var integration: String?
	var integrationIconUrl: String?
	var externalKey: String?
	var sessionPersonaImageUrl: String?
	var streamingAssistant: StreamingAssistantState?
	var turnWorkDurations: [Int: TimeInterval]
	var contextWindow: ContextWindowPayload?
	var promptText: String
	var activityLine: String
}

/// Pure session-identity transitions. Networking and task loops stay on `ChatStore`.
enum ChatSessionController {
	/// Whether `selectSession` should fetch — skip when already showing that session with content.
	static func shouldSelectSession(
		requestedId: String,
		currentSessionId: String?,
		transcriptIsEmpty: Bool,
		isLoading: Bool,
	) -> Bool {
		guard !isLoading else { return false }
		return currentSessionId != requestedId || transcriptIsEmpty
	}

	/// Apply a fetched `SessionDetail` as the active session.
	static func applyLoadedSession(_ detail: SessionDetail, into state: inout ChatSessionIdentityState) {
		state.sessionId = detail.id
		state.sessionName = detail.name
		state.sessionProjectId = projectId(from: detail)
		state.transcript = detail.transcript
		state.integration = detail.integration
		state.integrationIconUrl = detail.integrationIconUrl
		state.externalKey = detail.externalKey
		state.sessionPersonaImageUrl = detail.personaImageUrl
		state.streamingAssistant = nil
		state.turnWorkDurations = [:]
		state.contextWindow = detail.contextWindow
		state.promptText = ""
		state.activityLine = "Ready"
	}

	/// Reset to a local draft session (no server id yet).
	static func applyNewDraft(
		into state: inout ChatSessionIdentityState,
		personaImageUrl: String? = nil,
	) {
		state.sessionId = nil
		state.sessionName = "New chat"
		state.sessionProjectId = nil
		state.transcript = []
		state.integration = nil
		state.integrationIconUrl = nil
		state.externalKey = nil
		state.sessionPersonaImageUrl = personaImageUrl
		state.streamingAssistant = nil
		state.turnWorkDurations = [:]
		state.contextWindow = nil
		state.activityLine = "Ready"
	}

	/// Project id on a loaded session, if this is a project chat.
	static func projectId(from detail: SessionDetail) -> String? {
		let raw = detail.settings?.projectId?.trimmingCharacters(in: .whitespacesAndNewlines)
		guard let raw, !raw.isEmpty else { return nil }
		return raw
	}

	/// Lightweight poll update for external (e.g. Slack) sessions.
	static func applyExternalRefresh(_ detail: SessionDetail, into state: inout ChatSessionIdentityState) {
		state.sessionName = detail.name
		state.integrationIconUrl = detail.integrationIconUrl
		state.transcript = detail.transcript
		state.activityLine = "Ready"
	}
}
