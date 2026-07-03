import AppKit
import SwiftUI

struct RootView: View {
    @Bindable var store: ChatStore
    @Bindable var configureStore: ConfigureStore
    @Bindable var recordingsStore: RecordingsStore
    @Bindable var schedulesStore: SchedulesStore
    @Bindable var integrationsStore: ConfigureStore
    @Bindable var skillsStore: SkillsStore
    let personaEditorCoordinator: PersonaEditorCoordinator
    @Bindable var updateStore: UpdateStore
    @Bindable var changelogStore: ChangelogStore
    @Bindable var pluginsStore: PluginsStore
    @Environment(\.openWindow) private var openWindow
    @State private var history = NavigationHistory()
    @State private var isCommandPalettePresented = false
    @State private var isIssueReportPresented = false
    @State private var isAboutPresented = false
    @State private var pendingDeleteSession: SessionSummary?
    @State private var isToastHovered = false
    @State private var toastDismissTask: Task<Void, Never>?
    @State private var sidebarVisibility: NavigationSplitViewVisibility = .all
    @State private var mainWindow: NSWindow?

    private let toastDuration: UInt64 = 4_000_000_000

    var body: some View {
        contentWithAlerts
    }

    private var contentWithAlerts: some View {
        contentWithBackground
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

    private var contentWithBackground: some View {
        contentWithNotifications
            .background(WindowAccessor { window in
                mainWindow = window
            })
    }

    private var contentWithNotifications: some View {
        contentWithSheets
            .onReceive(NotificationCenter.default.publisher(for: .openCommandPalette)) { _ in
                isCommandPalettePresented = true
            }
            .onReceive(NotificationCenter.default.publisher(for: .openIssueReport)) { _ in
                isIssueReportPresented = true
            }
            .onReceive(NotificationCenter.default.publisher(for: .openChangelog)) { _ in
                isAboutPresented = true
            }
            .onReceive(NotificationCenter.default.publisher(for: .openRecordingFromToast)) { notification in
                if let id = notification.object as? String {
                    openRecording(id: id)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .startNewChat)) { _ in
                startNewChat()
            }
            .onReceive(NotificationCenter.default.publisher(for: .menuBarToggleRecording)) { _ in
                toggleRecording()
            }
            .onChange(of: store.isRecordingActive) { _, active in
                NotificationCenter.default.post(name: MenuBarController.recordingStateChanged, object: active)
            }
            .onChange(of: store.recordingProcessing?.stage) { _, stage in
                // Fallback: ensure the dock/menu bar overlay is cleared when
                // recording processing finishes, even if isRecordingActive
                // already transitioned without the onChange above firing.
                if (stage == .complete || stage == .failed), !store.isRecordingActive {
                    NotificationCenter.default.post(name: MenuBarController.recordingStateChanged, object: false)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .secondaryWindowClosed)) { _ in
                bringMainWindowToFront()
            }
            .onReceive(NotificationCenter.default.publisher(for: .startChatAboutRecording)) { notification in
                guard let request = notification.object as? StartChatAboutRecordingRequest else { return }
                bringMainWindowToFront()
                navigateToRoute(.chat)
                Task {
                    await store.startChatAboutRecording(
                        recordingId: request.recordingId,
                        name: request.name,
                        dateText: request.dateText,
                        hourText: request.hourText
                    )
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .showChatSession)) { notification in
                guard let sessionId = notification.object as? String else { return }
                bringMainWindowToFront()
                navigateToRoute(.chat)
                Task { await store.selectSession(id: sessionId) }
            }
            .onReceive(NotificationCenter.default.publisher(for: .navigateToRoute)) { notification in
                if let raw = notification.object as? String,
                   let route = DetailRoute(rawValue: raw)
                {
                    navigateToRoute(route)
                }
            }
    }

    @ViewBuilder
    private var contentWithSheets: some View {
        contentWithTasks
            .sheet(isPresented: $isCommandPalettePresented) {
                CommandPaletteView(
                    sessions: store.sessions,
                    integrations: integrationsStore.integrationSections,
                    schedules: schedulesStore.schedules,
                    recordings: recordingsStore.recordings,
                    onSelectSession: selectSession,
                    onNewChat: startNewChat,
                    onOpenSettings: { navigateToRoute(.settings) },
                    onNavigateToRoute: navigateToRoute,
                    onOpenIntegration: openIntegration,
                    onOpenSchedule: openSchedule,
                    onOpenRecording: openRecording,
                    onRestartServer: {
                        Task { await store.restartServer() }
                    },
                    onDismiss: { isCommandPalettePresented = false },
                )
                .presentationBackground(.clear)
            }
            .sheet(isPresented: $isIssueReportPresented) {
                IssueReportView(store: store) {
                    isIssueReportPresented = false
                }
            }
            .sheet(isPresented: $isAboutPresented) {
                AboutTobyView(
                    changelogStore: changelogStore,
                    updateStore: updateStore,
                    pluginsStore: pluginsStore,
                    appVersion: store.status?.version
                ) {
                    isAboutPresented = false
                }
            }
    }

    private var contentWithTasks: some View {
        contentWithOverlay
            .task {
                OpenWindowBridge.shared.openWindow = { id in openWindow(id: id) }
                applyDebugUpdateOverride()
                await store.bootstrap()
                applyDebugUpdateOverride()
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
            .task {
                updateStore.startCheckLoop()
            }
            .onChange(of: updateStore.upgradeComplete) { _, complete in
                guard complete else { return }
                store.toast = AppToastState(
                    style: .success,
                    title: "Update complete",
                    message: "Restart Toby to finish installing v\(updateStore.latestVersion ?? "").",
                    action: .restartApp
                )
            }
            .onChange(of: updateStore.upgradeError) { _, error in
                guard error != nil else { return }
                store.toast = AppToastState(
                    style: .error,
                    title: "Update failed",
                    message: updateStore.upgradeError
                )
            }
            .onChange(of: integrationsStore.errorMessage) { _, error in
                guard let error, !error.isEmpty, integrationsStore.tree != nil else { return }
                store.toast = AppToastState(
                    style: .error,
                    title: "Integration error",
                    message: error
                )
            }
    }

    private var contentWithOverlay: some View {
        routeContent
            .overlay(alignment: .bottomTrailing) { toastOverlay }
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
    }

    @ViewBuilder
    private var routeContent: some View {
        NavigationSplitView(columnVisibility: $sidebarVisibility) {
            AppSidebar(
                currentRoute: history.current,
                status: store.status,
                daemonStatus: store.daemonStatus,
                isServerRestarting: store.isServerRestarting,
                updateStore: updateStore,
                onSelectRoute: navigateToRoute,
                onCreatePersona: { openPersonaEditor(.create) },
                onEditPersona: { openPersonaEditor(.edit(name: $0)) },
                onPersonaSelected: refreshStatus,
                onCheckForUpdates: {
                    Task { await updateStore.checkNativeAppForUpdates() }
                },
                onRestartServer: {
                    Task { await store.restartServer() }
                },
                sidebarContent: {
                    switch history.current {
                    case .chat:
                        ChatSessionsSidebar(
                            sessions: store.sessions,
                            selectedSessionId: store.sessionId,
                            isLoading: store.isLoading,
                            isSessionsLoading: store.isSessionsLoading,
                            onSelectSession: { id in
                                selectSession(id)
                            },
                            onDeleteSession: { pendingDeleteSession = $0 },
                        )
                    case .integrations:
                        IntegrationsSidebarView(store: integrationsStore)
                    case .schedules:
                        SchedulesSidebarView(store: schedulesStore, onDelete: { schedule in
                            schedulesStore.pendingDelete = SchedulesStore.PendingDelete(
                                scheduleId: schedule.id, title: schedule.displayName
                            )
                        })
                    case .recordings:
                        RecordingsSidebarView(
                            store: recordingsStore,
                            processingState: store.recordingProcessing,
                            onDeleteRecording: { recording in
                                recordingsStore.pendingDeleteRecordingIds = [recording.id]
                            }
                        )
                    case .skills:
                        SkillsSidebarView(store: skillsStore, onDelete: { item in
                            skillsStore.pendingDelete = SkillsStore.PendingDelete(
                                dirName: item.dirName, name: item.name
                            )
                        })
                    case .settings:
                        ConfigureSidebarView(store: configureStore)
                    }
                }
            )
            .navigationSplitViewColumnWidth(AppTheme.sidebarWidth)
        } detail: {
            switch history.current {
            case .chat:
                ChatWorkspaceView(store: store)
                    .toolbar {
                        commonToolbarItems()
                        ToolbarItem(placement: .principal) {
                            SessionTitleBadge(title: store.sessionName, activityLine: store.activityLine)
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button(action: startNewChat) {
                                Image(systemName: "plus")
                            }
                            .help("New Chat")
                            .disabled(store.isLoading)
                            .accessibilityIdentifier("new-chat-button")
                        }
                    }
            case .integrations:
                IntegrationsView(store: integrationsStore)
                    .toolbar {
                        commonToolbarItems()
                        ToolbarItem(placement: .principal) { Spacer() }
                    }
            case .schedules:
                SchedulesView(store: schedulesStore)
                    .toolbar {
                        commonToolbarItems()
                        ToolbarItem(placement: .principal) { Spacer() }
                        ToolbarItem(placement: .confirmationAction) {
                            if let schedule = schedulesStore.selectedSchedule {
                                Button {
                                    Task { await schedulesStore.runSchedule(id: schedule.id) }
                                } label: {
                                    Image(systemName: "play.fill")
                                }
                                .help("Run Now")
                                .disabled(schedulesStore.runningScheduleId != nil || schedulesStore.isSaving)
                                .accessibilityIdentifier("run-schedule-button")
                            }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            if let schedule = schedulesStore.selectedSchedule {
                                Button(role: .destructive) {
                                    schedulesStore.pendingDelete = SchedulesStore.PendingDelete(
                                        scheduleId: schedule.id,
                                        title: schedule.displayName
                                    )
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .help("Delete Schedule")
                                .disabled(schedulesStore.deletingScheduleId != nil || schedulesStore.isSaving)
                                .accessibilityIdentifier("delete-schedule-button")
                            }
                        }
                    }
            case .recordings:
                RecordingsView(store: recordingsStore, processingState: store.recordingProcessing, validSessionIds: Set(store.sessions.map(\.id)))
                    .toolbar {
                        commonToolbarItems()
                        ToolbarItem(placement: .principal) { Spacer() }
                        ToolbarItem(placement: .confirmationAction) {
                            if !recordingsStore.selectedRecordings.isEmpty {
                                Button(role: .destructive) {
                                    recordingsStore.pendingDeleteRecordingIds = Set(recordingsStore.selectedRecordings.map(\.id))
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .help(recordingsDeleteButtonTitle)
                                .disabled(recordingsStore.isDeletingSelection)
                                .accessibilityIdentifier("delete-recordings-button")
                            }
                        }
                    }
            case .skills:
                SkillsView(store: skillsStore)
                    .toolbar {
                        commonToolbarItems()
                        ToolbarItem(placement: .principal) { Spacer() }
                        ToolbarItem(placement: .confirmationAction) {
                            if let skill = skillsStore.selectedSkill {
                                Button(role: .destructive) {
                                    skillsStore.pendingDelete = SkillsStore.PendingDelete(
                                        dirName: skill.dirName,
                                        name: skill.name
                                    )
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .help("Delete Skill")
                                .disabled(skillsStore.isSaving)
                                .accessibilityIdentifier("delete-skill-button")
                            }
                        }
                    }
            case .settings:
                ConfigureView(store: configureStore)
                    .toolbar {
                        commonToolbarItems()
                        ToolbarItem(placement: .principal) { Spacer() }
                    }
            }
        }
    }

    @ToolbarContentBuilder
    private func commonToolbarItems() -> some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            RecordingToolbarButton(
                isRecordingActive: store.isRecordingActive,
                isRecordButtonDisabled: store.isRecordButtonDisabled,
                onToggleRecording: toggleRecording
            )
        }
        ToolbarItem(placement: .navigation) {
            SearchToolbarButton(onSearch: openCommandPalette)
        }
        ToolbarItem(placement: .navigation) {
            Button(action: { _ = history.goBack() }) {
                Image(systemName: "chevron.backward")
            }
            .disabled(!history.canGoBack)
            .help("Back")
            .accessibilityIdentifier("nav-back-button")
        }
        ToolbarItem(placement: .navigation) {
            Button(action: { _ = history.goForward() }) {
                Image(systemName: "chevron.forward")
            }
            .disabled(!history.canGoForward)
            .help("Forward")
            .accessibilityIdentifier("nav-forward-button")
        }
    }

    private func openCommandPalette() {
        isCommandPalettePresented = true
    }

    private var recordingsDeleteButtonTitle: String {
        if recordingsStore.selectedRecordings.count == 1 {
            return "Delete Recording"
        }
        return "Delete \(recordingsStore.selectedRecordings.count) Recordings"
    }

    @ViewBuilder
    private var toastOverlay: some View {
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

    private func startNewChat() {
        Task { await store.startNewSession() }
    }

    private func bringMainWindowToFront() {
        NSApp.activate(ignoringOtherApps: true)
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    private func selectSession(_ id: String) {
        Task { await store.selectSession(id: id) }
    }

    private func toggleRecording() {
        Task { await store.toggleRecording() }
    }

    private func navigateToRoute(_ route: DetailRoute) {
        history.navigate(to: route)
    }

    private func openSettings(navKey: String? = nil) {
        if let navKey {
            configureStore.selectedNavKey = navKey
        }
        navigateToRoute(.settings)
    }

    private func openIntegration(navKey: String) {
        integrationsStore.selectedNavKey = navKey
        navigateToRoute(.integrations)
    }

    private func openSchedule(id: String) {
        Task { await schedulesStore.selectSchedule(id: id) }
        navigateToRoute(.schedules)
    }

    private func openRecording(id: String) {
        Task { await recordingsStore.selectRecording(id: id) }
        navigateToRoute(.recordings)
    }

    private func handleToastAction(_ action: AppToastAction) {
        switch action {
        case .openRecording(let id):
            NotificationCenter.default.post(name: .openRecordingFromToast, object: id)
        case .openURL(let urlString):
            if let url = URL(string: urlString) {
                NSWorkspace.shared.open(url)
            }
        case .restartApp:
            updateStore.relaunchApp()
        case .openSettings(let navKey):
            openSettings(navKey: navKey)
        }
    }

    private func openPersonaEditor(_ mode: PersonaEditorStore.Mode) {
        personaEditorCoordinator.store = PersonaEditorStore(mode: mode)
        openWindow(id: "persona-editor")
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

#if DEBUG
    private func applyDebugUpdateOverride() {
        let environment = ProcessInfo.processInfo.environment
        let latestVersion = environment["TOBY_DEBUG_LATEST_VERSION"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let latestVersion, !latestVersion.isEmpty else { return }

        let currentVersion = environment["TOBY_DEBUG_CURRENT_VERSION"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        updateStore.latestVersion = latestVersion.hasPrefix("v") ? String(latestVersion.dropFirst()) : latestVersion
        updateStore.isUpdateAvailable = true

        if let currentVersion, !currentVersion.isEmpty {
            let currentStatus = store.status
            store.status = AppStatus(
                version: currentVersion.hasPrefix("v") ? String(currentVersion.dropFirst()) : currentVersion,
                persona: currentStatus?.persona ?? "default",
                model: currentStatus?.model ?? "debug",
                contextWindow: currentStatus?.contextWindow,
                personaImageUrl: currentStatus?.personaImageUrl,
                connectedIntegrations: currentStatus?.connectedIntegrations,
                skillCount: currentStatus?.skillCount,
                skills: currentStatus?.skills,
                transcription: currentStatus?.transcription
            )
        }
    }
#else
    private func applyDebugUpdateOverride() {}
#endif

}

extension Notification.Name {
    static let openCommandPalette = Notification.Name("openCommandPalette")
    static let openIssueReport = Notification.Name("openIssueReport")
    static let openChangelog = Notification.Name("openChangelog")
    static let openRecordingFromToast = Notification.Name("openRecordingFromToast")
    static let startNewChat = Notification.Name("startNewChat")
    static let startChatAboutRecording = Notification.Name("startChatAboutRecording")
    static let showChatSession = Notification.Name("showChatSession")
    static let secondaryWindowClosed = Notification.Name("secondaryWindowClosed")
    static let menuBarToggleRecording = Notification.Name("menuBarToggleRecording")
    static let navigateToRoute = Notification.Name("navigateToRoute")
}

struct StartChatAboutRecordingRequest {
    let recordingId: String
    let name: String
    let dateText: String
    let hourText: String
}
