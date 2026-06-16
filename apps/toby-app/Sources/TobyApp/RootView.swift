import SwiftUI

struct RootView: View {
	@Bindable var store: ChatStore
	@Bindable var configureStore: ConfigureStore
	@Environment(\.openWindow) private var openWindow
	@State private var isCommandPalettePresented = false

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
				onOpenPersonasSettings: openPersonasSettings,
				onPersonaSelected: refreshStatus,
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
				onOpenSettings: { openSettings() },
				onDismiss: { isCommandPalettePresented = false },
			)
			.presentationBackground(.clear)
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

	private func openSettings(navKey: String? = nil) {
		if let navKey {
			configureStore.selectedNavKey = navKey
		}
		openWindow(id: "settings")
	}

	private func openPersonasSettings() {
		openSettings(navKey: "personas")
	}

	private func refreshStatus() {
		Task { await store.refreshStatus() }
	}
}

extension Notification.Name {
	static let openCommandPalette = Notification.Name("openCommandPalette")
}
