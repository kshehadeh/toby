import SwiftUI

struct RootView: View {
    @Bindable var store: ChatStore
    @Bindable var configureStore: ConfigureStore
    @Bindable var recordingsStore: RecordingsStore
    @Bindable var schedulesStore: SchedulesStore
    @Bindable var integrationsStore: ConfigureStore
    @Bindable var skillsStore: SkillsStore
    @Environment(\.openWindow) private var openWindow
    @State private var isCommandPalettePresented = false
    @State private var isIssueReportPresented = false
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
                onSelectSession: selectSession,
                onDeleteSession: { pendingDeleteSession = $0 },
                onOpenSettings: openSettings,
                onOpenRecordings: openRecordings,
                onOpenSchedules: openSchedules,
                onOpenIntegrations: openIntegrations,
                onOpenSkills: openSkills,
                onOpenPersonasSettings: openPersonasSettings,
                onPersonaSelected: refreshStatus,
                onOpenChangelog: { openWindow(id: "changelog") },
            )
            .navigationSplitViewColumnWidth(AppTheme.sidebarWidth)
        } detail: {
            ChatWorkspaceView(store: store)
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
                    ToolbarItem(placement: .confirmationAction) {
                        Button(action: toggleRecording) {
                            Image(systemName: store.isRecordingActive ? "stop.circle" : "record.circle")
                                .foregroundStyle(store.isRecordingActive ? .red : .primary)
                        }
                        .help(store.isRecordingActive ? "Stop Recording" : "Record Audio")
                        .accessibilityLabel(store.isRecordingActive ? "Stop Recording" : "Record Audio")
                        .disabled(store.isRecordButtonDisabled)
                    }
                }
        }
        .overlay(alignment: .bottomTrailing) {
            if let toast = store.toast {
                ToastView(
                    toast: toast,
                    onDismiss: dismissToast,
                    onAction: handleToastAction
                )
                    .frame(maxWidth: 420)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
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
                        if !isProcessingToast {
                            dismissToast()
                        }
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.28, dampingFraction: 0.82), value: store.toast?.id)
        .onChange(of: store.toast?.id) { (_: UUID?, id: UUID?) in
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
        .task {
            async let recordings: () = recordingsStore.load()
            async let schedules: () = schedulesStore.load()
            async let integrations: () = integrationsStore.load()
            _ = await (recordings, schedules, integrations)
        }
        .sheet(isPresented: $isCommandPalettePresented) {
            CommandPaletteView(
                sessions: store.sessions,
                integrations: integrationsStore.integrationSections,
                schedules: schedulesStore.schedules,
                recordings: recordingsStore.recordings,
                onSelectSession: selectSession,
                onNewChat: startNewChat,
                onOpenSettings: { openSettings() },
                onOpenIntegration: openIntegration,
                onOpenSchedule: openSchedule,
                onOpenRecording: openRecording,
                onDismiss: { isCommandPalettePresented = false },
            )
            .presentationBackground(.clear)
        }
        .sheet(isPresented: $isIssueReportPresented) {
            IssueReportView(store: store) {
                isIssueReportPresented = false
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .openCommandPalette)) { _ in
            isCommandPalettePresented = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .openIssueReport)) { _ in
            isIssueReportPresented = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .openChangelog)) { _ in
            openWindow(id: "changelog")
        }
        .onReceive(NotificationCenter.default.publisher(for: .openRecordingFromToast)) { notification in
            if let id = notification.object as? String {
                openRecording(id: id)
            }
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

    private func openIntegrations() {
        openWindow(id: "integrations")
    }

    private func openSkills() {
        openWindow(id: "skills")
    }

    private func openIntegration(navKey: String) {
        integrationsStore.selectedNavKey = navKey
        openWindow(id: "integrations")
    }

    private func openSchedule(id: String) {
        Task { await schedulesStore.selectSchedule(id: id) }
        openWindow(id: "schedules")
    }

    private func openRecording(id: String) {
        Task { await recordingsStore.selectRecording(id: id) }
        openWindow(id: "recordings")
    }

    private func handleToastAction(_ action: AppToastAction) {
        switch action {
        case .openRecording(let id):
            NotificationCenter.default.post(name: .openRecordingFromToast, object: id)
        }
    }

    private func openPersonasSettings() {
        openSettings(navKey: "personas")
    }

    private func refreshStatus() {
        Task { await store.refreshStatus() }
    }

    private func scheduleToastDismiss() {
        toastDismissTask?.cancel()
        guard store.toast != nil, !isToastHovered, !isProcessingToast else { return }
        toastDismissTask = Task {
            try? await Task.sleep(nanoseconds: toastDuration)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                if !isToastHovered && !isProcessingToast {
                    store.toast = nil
                    toastDismissTask = nil
                }
            }
        }
    }

    private var isProcessingToast: Bool {
        store.recordingProcessing?.isActive == true
    }

    private func dismissToast() {
        toastDismissTask?.cancel()
        toastDismissTask = nil
        store.toast = nil
        store.recordingProcessing = nil
        isToastHovered = false
    }

}

extension Notification.Name {
    static let openCommandPalette = Notification.Name("openCommandPalette")
    static let openIssueReport = Notification.Name("openIssueReport")
    static let openChangelog = Notification.Name("openChangelog")
    static let openRecordingFromToast = Notification.Name("openRecordingFromToast")
    static let startNewChat = Notification.Name("startNewChat")
}
