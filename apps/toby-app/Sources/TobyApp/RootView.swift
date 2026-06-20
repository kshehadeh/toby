import SwiftUI

struct RootView: View {
    @Bindable var store: ChatStore
    @Bindable var configureStore: ConfigureStore
    @Environment(\.openWindow) private var openWindow
    @State private var isCommandPalettePresented = false
    @State private var isIssueReportPresented = false
    @State private var isChangelogPresented = false
    @State private var pendingDeleteSession: SessionSummary?
    @State private var isToastHovered = false
    @State private var toastDismissTask: Task<Void, Never>?
    @State private var sidebarVisibility: NavigationSplitViewVisibility = .all

    private let toastDuration: UInt64 = 4_000_000_000

    var body: some View {
        NavigationSplitView(columnVisibility: $sidebarVisibility) {
            AppSidebar(
                sessions: store.sessions,
                selectedSessionId: store.sessionId,
                status: store.status,
                daemonStatus: store.daemonStatus,
                isLoading: store.isLoading,
                isSessionsLoading: store.isSessionsLoading,
                isRecording: store.isRecordingActive,
                isRecordDisabled: store.isRecordButtonDisabled,
                onToggleRecording: toggleRecording,
                onSelectSession: selectSession,
                onDeleteSession: { pendingDeleteSession = $0 },
                onOpenSettings: openSettings,
                onOpenRecordings: openRecordings,
                onOpenSchedules: openSchedules,
                onOpenPersonasSettings: openPersonasSettings,
                onPersonaSelected: refreshStatus,
                onOpenChangelog: { isChangelogPresented = true },
            )
            .navigationSplitViewColumnWidth(
                min: 220,
                ideal: AppTheme.sidebarWidth,
                max: 320,
            )
            .toolbar(removing: .sidebarToggle)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: startNewChat) {
                        Image(systemName: "plus")
                    }
                    .help("New Chat")
                    .disabled(store.isLoading)
                    .accessibilityIdentifier("new-chat-button")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: { isCommandPalettePresented = true }) {
                        Image(systemName: "magnifyingglass")
                    }
                    .help("Search")
                    .accessibilityLabel("Search")
                }
            }
        } detail: {
            ChatWorkspaceView(store: store)
        }
        .overlay(alignment: .top) {
            if let toast = store.toast {
                ToastView(toast: toast, onDismiss: dismissToast)
                    .frame(maxWidth: 420)
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .contentShape(Rectangle())
                    .onHover { hovering in
                        isToastHovered = hovering
                        if hovering {
                            toastDismissTask?.cancel()
                            toastDismissTask = nil
                        } else {
                            scheduleToastDismiss()
                        }
                    }
                    .onTapGesture {
                        dismissToast()
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.82), value: store.toast?.id)
        .onChange(of: store.toast?.id) { _, id in
            isToastHovered = false
            if id == nil {
                toastDismissTask?.cancel()
                toastDismissTask = nil
            } else {
                scheduleToastDismiss()
            }
        }
        .onDisappear {
            toastDismissTask?.cancel()
            toastDismissTask = nil
        }
        .task {
            await store.bootstrap()
        }
        .task {
            await store.daemonStatusRefreshLoop()
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
        .sheet(isPresented: $isIssueReportPresented) {
            IssueReportView(store: store) {
                isIssueReportPresented = false
            }
        }
        .sheet(isPresented: $isChangelogPresented) {
            ChangelogView {
                isChangelogPresented = false
            }
            .presentationBackground(.clear)
        }
        .onReceive(NotificationCenter.default.publisher(for: .openCommandPalette)) { _ in
            isCommandPalettePresented = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .openIssueReport)) { _ in
            isIssueReportPresented = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .openChangelog)) { _ in
            isChangelogPresented = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .startNewChat)) { _ in
            startNewChat()
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

    private func toggleRecording() {
        Task { await store.toggleRecording() }
    }

    private func openSettings(navKey: String? = nil) {
        if let navKey {
            configureStore.selectedNavKey = navKey
        }
        openWindow(id: "settings")
    }

    private func openRecordings() {
        openWindow(id: "recordings")
    }

    private func openSchedules() {
        openWindow(id: "schedules")
    }

    private func openPersonasSettings() {
        openSettings(navKey: "personas")
    }

    private func refreshStatus() {
        Task { await store.refreshStatus() }
    }

    private func scheduleToastDismiss() {
        toastDismissTask?.cancel()
        guard store.toast != nil, !isToastHovered else { return }
        toastDismissTask = Task {
            try? await Task.sleep(nanoseconds: toastDuration)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                if !isToastHovered {
                    store.toast = nil
                    toastDismissTask = nil
                }
            }
        }
    }

    private func dismissToast() {
        toastDismissTask?.cancel()
        toastDismissTask = nil
        store.toast = nil
        isToastHovered = false
    }

}

extension Notification.Name {
    static let openCommandPalette = Notification.Name("openCommandPalette")
    static let openIssueReport = Notification.Name("openIssueReport")
    static let openChangelog = Notification.Name("openChangelog")
    static let startNewChat = Notification.Name("startNewChat")
}
