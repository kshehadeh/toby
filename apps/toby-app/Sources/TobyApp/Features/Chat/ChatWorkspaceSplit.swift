import SwiftUI

/// Conversation list plus transcript for the Chats workspace.
struct ChatWorkspaceSplit: View {
	@Bindable var store: ChatStore
	@Binding var preferSessionList: Bool
	let onSelectSession: (String) -> Void
	let onDeleteSession: (SessionSummary) -> Void

	var body: some View {
		FeatureWorkspaceSplit(
			listTitle: "Chats",
			isShowingList: showsListOnly,
			onShowList: { preferSessionList = true }
		) {
			sessionList
		} detail: {
			ChatWorkspaceView(store: store)
		}
	}

	private var showsListOnly: Bool {
		preferSessionList
			|| (store.sessions.isEmpty && store.transcript.isEmpty && store.streamingAssistant == nil)
	}

	private var sessionList: some View {
		ChatSessionsSidebar(
			sessions: store.sessions,
			selectedSessionId: store.sessionId,
			isLoading: store.isLoading,
			isSessionsLoading: store.isSessionsLoading,
			onSelectSession: { id in
				preferSessionList = false
				onSelectSession(id)
			},
			onDeleteSession: onDeleteSession
		)
		.accessibilityIdentifier("chat-session-browser")
	}
}
