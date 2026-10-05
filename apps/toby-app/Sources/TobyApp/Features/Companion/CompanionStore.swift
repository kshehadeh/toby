import Foundation
import Observation

extension Notification.Name {
	static let companionSessionDidChange = Notification.Name("toby.companion.sessionDidChange")
}

/// Owns a separate chat workspace; the shared chat store handles daemon turns.
@Observable @MainActor
final class CompanionStore {
	var draft = ""
	var bubblePointsRight = true
	var bubbleTailY: CGFloat = 56
	var presentationID = UUID()
	private(set) var chat: ChatStore
	private(set) var isThinking = false
	private(set) var errorMessage: String?
	private let suppliedClient: (any ChatClientable)?
	private var replyTask: Task<Void, Never>?
	private var generation = UUID()

	init(client: (any ChatClientable)? = nil) {
		suppliedClient = client
		chat = ChatStore(client: client ?? TobyClient())
	}

	var hasConversation: Bool { isThinking || !chat.transcript.isEmpty }

	/// The companion is conversation-only, even while main Chats uses Debug.
	/// Filter before grouping so work cards cannot expose prep, skills, or tools.
	var conversationEntries: [TranscriptEntry] {
		chat.transcript.filter { entry in
			switch entry {
			case .user, .assistant, .error, .askUserQA:
				return true
			case .boxedStep(let step):
				return step.variant == "assistant" || step.variant == "assistant_interim"
			case .notice(let text, _):
				return !TranscriptGrouping.isSelectionNotice(text)
					&& !TranscriptGrouping.isToolSelectionNotice(text)
			case .meta, .toolCall, .toolOutput, .turnWork:
				return false
			}
		}
	}

	var activityLabel: String {
		if chat.activeAskUserPrompt != nil { return "Waiting for your choice…" }
		return chat.isLoading ? "Thinking…" : "Connecting…"
	}

	var isProcessingResponse: Bool {
		(isThinking || chat.isLoading) && chat.activeAskUserPrompt == nil
	}

	var speakingText: String? {
		// inWorkArea is a transcript placement flag, including ordinary replies
		// before any tool calls. Every streamingAssistant contains assistant text.
		guard isProcessingResponse, let stream = chat.streamingAssistant,
			!stream.text.isEmpty else { return nil }
		return stream.text
	}

	var bubbleSize: CGSize {
		CGSize(width: CompanionGeometry.bubbleSize.width, height: hasConversation ? 480 : (errorMessage == nil ? 184 : 320))
	}
	var canSubmit: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isThinking }
	var canStop: Bool { chat.isLoading }

	func send() {
		guard canSubmit else { return }
		let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
		draft = ""
		errorMessage = nil
		isThinking = true
		let token = generation
		// Pin the daemon address for the conversation, including cancellation if
		// the user switches Toby home directories during an active turn.
		let client = suppliedClient ?? TobyClient(baseURL: ConfigReader.baseURL())
		if chat.sessionId == nil && chat.transcript.isEmpty { chat = ChatStore(client: client) }
		let workspace = chat
		replyTask = Task { [weak self] in
			guard let self else { return }
			do {
				workspace.status = try await client.fetchStatus()
				try Task.checkCancellation()
				workspace.promptText = text
				workspace.toast = nil
				await workspace.submitPrompt()
				guard generation == token else { return }
				if workspace.sessionId == nil {
					errorMessage = workspace.toast?.message ?? workspace.toast?.title ?? "Could not create a chat. Try again."
					draft = text
				}
				if workspace.sessionId != nil {
					NotificationCenter.default.post(name: .companionSessionDidChange, object: nil)
				}
			} catch {
				guard generation == token else { return }
				errorMessage = error.localizedDescription
				draft = text
			}
			guard generation == token else { return }
			isThinking = false
			replyTask = nil
		}
	}

	func stop() {
		chat.cancelAskUserPrompt()
		chat.cancelActiveTurn()
	}

	func reset() {
		guard !isThinking else { return }
		clearWorkspace()
	}

	func resetForHomeSwitch() {
		stop()
		replyTask?.cancel()
		clearWorkspace()
	}

	private func clearWorkspace() {
		generation = UUID()
		replyTask = nil
		isThinking = false
		draft = ""
		errorMessage = nil
		chat = ChatStore(client: suppliedClient ?? TobyClient())
	}
}
