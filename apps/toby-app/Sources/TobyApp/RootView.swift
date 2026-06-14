import SwiftUI

struct RootView: View {
	@Bindable var store: ChatStore
	@State private var configureStore = ConfigureStore()
	@State private var isCommandPalettePresented = false
	@State private var isConfigurePresented = false

	var body: some View {
		HStack(spacing: 0) {
			AppSidebar(
				sessions: store.sessions,
				selectedSessionId: store.sessionId,
				status: store.status,
				isLoading: store.isLoading,
				isSessionsLoading: store.isSessionsLoading,
				onNewChat: startNewChat,
				onSearch: { isCommandPalettePresented = true },
				onSelectSession: selectSession,
				onOpenSettings: openSettings,
			)
			ChatWorkspaceView(store: store)
		}
		.task {
			await store.bootstrap()
		}
		.sheet(isPresented: $isCommandPalettePresented) {
			CommandPaletteView(
				sessions: store.sessions,
				onSelectSession: selectSession,
				onNewChat: startNewChat,
				onOpenSettings: openSettings,
				onDismiss: { isCommandPalettePresented = false },
			)
			.presentationBackground(.clear)
		}
		.sheet(isPresented: $isConfigurePresented) {
			ConfigureView(store: configureStore) {
				isConfigurePresented = false
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .openCommandPalette)) { _ in
			isCommandPalettePresented = true
		}
	}

	private func startNewChat() {
		Task { await store.startNewSession() }
	}

	private func selectSession(_ id: String) {
		Task { await store.selectSession(id: id) }
	}

	private func openSettings() {
		isConfigurePresented = true
	}
}

extension Notification.Name {
	static let openCommandPalette = Notification.Name("openCommandPalette")
}
