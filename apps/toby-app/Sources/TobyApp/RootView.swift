import SwiftUI

struct RootView: View {
	@Bindable var store: ChatStore

	var body: some View {
		HStack(spacing: 0) {
			AppSidebar(
				sessionName: store.sessionName,
				status: store.status,
				isLoading: store.isLoading,
				onNewChat: startNewChat,
			)
			ChatWorkspaceView(store: store)
		}
		.task {
			await store.bootstrap()
		}
	}

	private func startNewChat() {
		Task { await store.startNewSession() }
	}
}
