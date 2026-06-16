import SwiftUI

struct RootView: View {
	@Bindable var store: ChatStore
	@Bindable var configureStore: ConfigureStore
	@Environment(\.openWindow) private var openWindow
	@State private var isCommandPalettePresented = false
	@State private var pendingDeleteSession: SessionSummary?

	var body: some View {
		NavigationSplitView {
			AppSidebar(
				sessions: store.sessions,
				selectedSessionId: store.sessionId,
				status: store.status,
				isLoading: store.isLoading,
				isSessionsLoading: store.isSessionsLoading,
				onNewChat: startNewChat,
				onSearch: { isCommandPalettePresented = true },
				onSelectSession: selectSession,
				onDeleteSession: { pendingDeleteSession = $0 },
				onOpenSettings: openSettings,
				onOpenPersonasSettings: openPersonasSettings,
				onPersonaSelected: refreshStatus,
			)
			.navigationSplitViewColumnWidth(
				min: 220,
				ideal: AppTheme.sidebarWidth,
				max: 320,
			)
		} detail: {
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
		.alert(
			"Delete Session?",
			isPresented: Binding(
				get: { pendingDeleteSession != nil },
				set: { if !$0 { pendingDeleteSession = nil } },
			),
			presenting: pendingDeleteSession,
		) { session in
			Button("Cancel", role: .cancel) {
				pendingDeleteSession = nil
			}
			Button("Delete", role: .destructive) {
				pendingDeleteSession = nil
				Task { await store.deleteSession(id: session.id) }
			}
		} message: { session in
			Text("Are you sure you want to delete \"\(session.name)\"? This cannot be undone.")
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
