import AppKit
import SwiftUI

struct RootView: View {
    @Bindable var store: ChatStore
    @Bindable var dashboardStore: DashboardStore
    @Bindable var configureStore: ConfigureStore
    @Bindable var recordingsStore: RecordingsStore
    @Bindable var schedulesStore: SchedulesStore
    @Bindable var projectsStore: ProjectsStore = ProjectsStore()
    @Bindable var integrationsStore: ConfigureStore
    @Bindable var skillsStore: SkillsStore
    @Bindable var memoriesStore: MemoriesStore
    @Bindable var flowsStore: FlowsStore
    let personaEditorCoordinator: PersonaEditorCoordinator
    @Bindable var updateStore: UpdateStore
    @Bindable var changelogStore: ChangelogStore
    @Bindable var pluginsStore: PluginsStore
    @Environment(\.openWindow) private var openWindow
    @Environment(AppearancePreferences.self) private var appearancePreferences
    @State private var permissionsStore = PermissionsStore()
    @State private var history = NavigationHistory()
    @State private var isIssueReportPresented = false
    @State private var isAboutPresented = false
    @State private var isBackupSheetPresented = false
    @State private var restoreSelection: RestoreBackupSelection?
    @State private var pendingDeleteSession: SessionSummary?
    @State private var isToastHovered = false
    @State private var toastDismissTask: Task<Void, Never>?
    @State private var sidebarVisibility: NavigationSplitViewVisibility = .all
    @State private var mainWindow: NSWindow?
    @State private var sidebarActionHelp: SidebarActionHelpPresentation?
    @State private var longRecordingPromptCoordinator = LongRecordingPromptCoordinator()
    /// Becomes true after bootstrap handshake + first shared data load (and
    /// permissions refresh). Gates onboarding so incomplete defaults do not flash.
    @State private var hasCompletedInitialLoad = false
    @State private var isPersonaPickerPresented = false
    @State private var isPersonaAttentionHighlighted = false
    @State private var emphasizeCreatePersona = false
    @State private var personaAttentionTask: Task<Void, Never>?
    @State private var isAIProviderChooserPresented = false
    /// When non-nil, present guided setup for this provider id.
    @State private var aiProviderSetupProviderId: String?

    private let toastDuration: UInt64 = 4_000_000_000

    var body: some View {
        contentWithCreateActions
    }

    /// Isolated so File → New * menu actions do not overload the type checker.
    private var contentWithCreateActions: some View {
        contentWithBackup
            .onReceive(NotificationCenter.default.publisher(for: .startNewSchedule)) { _ in
                startNewSchedule()
            }
            .onReceive(NotificationCenter.default.publisher(for: .startNewProject)) { _ in
                startNewProject()
            }
            .onReceive(NotificationCenter.default.publisher(for: .startNewMemory)) { _ in
                startNewMemory()
            }
            .onReceive(NotificationCenter.default.publisher(for: .memoriesDidChange)) { _ in
                memoriesStore.handleExternalMemoryChange()
            }
            .onReceive(NotificationCenter.default.publisher(for: .personasDidChange)) { _ in
                Task {
                    await configureStore.handlePersonasChanged()
                    await schedulesStore.refreshPersonas()
                    await projectsStore.refreshPersonas()
                }
            }
    }

    /// Isolated so File → Backup / Restore sheets and notifications do not
    /// overload the type checker on the main notification/sheet chains.
    private var contentWithBackup: some View {
        contentWithAlerts
            .onReceive(NotificationCenter.default.publisher(for: .backupConfig)) { _ in
                bringMainWindowToFront()
                isBackupSheetPresented = true
            }
            .onReceive(NotificationCenter.default.publisher(for: .restoreConfig)) { _ in
                bringMainWindowToFront()
                if let url = ConfigBackupFilePanels.presentOpenPanel() {
                    restoreSelection = RestoreBackupSelection(url: url)
                }
            }
            .sheet(isPresented: $isBackupSheetPresented) {
                ConfigBackupSheet(
                    onDismiss: { isBackupSheetPresented = false },
                    onSuccess: { path in
                        store.toast = AppToastState(
                            style: .success,
                            title: "Backup saved",
                            message: path
                        )
                    },
                    onError: { message in
                        store.toast = AppToastState(
                            style: .error,
                            title: "Backup failed",
                            message: message
                        )
                    }
                )
            }
            .sheet(item: $restoreSelection) { selection in
                ConfigRestoreSheet(
                    backupURL: selection.url,
                    onDismiss: { restoreSelection = nil },
                    onSuccess: {
                        store.toast = AppToastState(
                            style: .success,
                            title: "Settings restored",
                            message: "Config and credentials were replaced from the backup."
                        )
                        Task {
                            await store.refreshStatus()
                            await configureStore.loadSettingsSections()
                            await integrationsStore.loadSettingsSections()
                        }
                    },
                    onError: { message in
                        store.toast = AppToastState(
                            style: .error,
                            title: "Restore failed",
                            message: message
                        )
                    }
                )
            }
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
            .onAppear {
                configureStore.onChangesSaved = { Task { await store.refreshStatus() } }
                integrationsStore.onChangesSaved = { Task { await store.refreshStatus() } }
            }
    }

    private var contentWithNotifications: some View {
        contentWithSheets
            .onReceive(NotificationCenter.default.publisher(for: .openCommandPalette)) { _ in
                presentCommandPalette()
            }
            .onReceive(NotificationCenter.default.publisher(for: .openIssueReport)) { _ in
                isIssueReportPresented = true
            }
            .onReceive(NotificationCenter.default.publisher(for: .openChangelog)) { _ in
                presentAbout()
            }
            .onReceive(NotificationCenter.default.publisher(for: .openRecordingFromToast)) { notification in
                if let id = notification.object as? String {
                    openRecording(id: id)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .openScheduleFromNotification)) { notification in
                guard let request = notification.object as? OpenScheduleFromNotificationRequest else { return }
                openScheduleFromNotification(id: request.scheduleId)
            }
            .onReceive(NotificationCenter.default.publisher(for: .startNewChat)) { _ in
                bringMainWindowToFront()
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
            .onReceive(NotificationCenter.default.publisher(for: .openSettingsWindow)) { notification in
                // Prefer `object` (primary); accept userInfo["navKey"] as a fallback.
                let navKey =
                    (notification.object as? String)
                    ?? (notification.userInfo?["navKey"] as? String)
                openSettings(navKey: navKey)
            }
    }

    @ViewBuilder
    private var contentWithSheets: some View {
        contentWithTasks
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
                    appVersion: store.status?.version,
                    tobyDirectory: store.status?.tobyDir
                ) {
                    isAboutPresented = false
                }
            }
            .sheet(
                isPresented: Binding(
                    get: { longRecordingPromptCoordinator.presentedPrompt != nil },
                    set: { _ in }
                )
            ) {
                if let prompt = longRecordingPromptCoordinator.presentedPrompt {
                    LongRecordingConfirmationView(
                        prompt: prompt,
                        onContinue: continueLongRecording,
                        onStop: stopLongRecordingFromPrompt
                    )
                    .presentationBackground(.clear)
                    .interactiveDismissDisabled(true)
                }
            }
            .sheet(isPresented: $isAIProviderChooserPresented) {
                AIProviderSetupChooserView(
                    onSelect: { providerId in
                        isAIProviderChooserPresented = false
                        // Present the wizard after the chooser sheet dismisses.
                        Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(200))
                            aiProviderSetupProviderId = providerId
                        }
                    },
                    onDismiss: { isAIProviderChooserPresented = false },
                    onBrowseAllProviders: {
                        isAIProviderChooserPresented = false
                        openSettings(navKey: "ai")
                    }
                )
            }
            .sheet(item: Binding(
                get: { aiProviderSetupProviderId.map { AIProviderSetupSheetItem(id: $0) } },
                set: { aiProviderSetupProviderId = $0?.id }
            )) { item in
                VercelAIGatewaySetupWizardView(
                    providerId: item.id,
                    onCompleted: {
                        Task {
                            await store.refreshStatus()
                            await configureStore.loadSettingsSections()
                            await integrationsStore.loadSettingsSections()
                        }
                    },
                    onDismiss: { aiProviderSetupProviderId = nil }
                )
            }
    }

    /// Identifiable wrapper so `.sheet(item:)` can present setup by provider id.
    private struct AIProviderSetupSheetItem: Identifiable {
        let id: String
    }

    private var contentWithTasks: some View {
        contentWithOverlay
            .task {
                OpenWindowBridge.shared.openWindow = { id in openWindow(id: id) }
                applyDebugUpdateOverride()
                await store.bootstrap()
                applyDebugUpdateOverride()
                await loadSharedAppDataIfConnected()
                // Permissions start as all-denied defaults; refresh before
                // evaluating onboarding completeness.
                permissionsStore.refresh()
                hasCompletedInitialLoad = store.isServerReady
            }
            .task {
                await store.daemonStatusRefreshLoop()
            }
            .task {
                await longRecordingPromptLoop()
            }
            .onChange(of: isPersonaPickerPresented) { _, presented in
                // Create emphasis only applies while the popover is open.
                // Keep the footer glow for the attention timer so the control
                // remains discoverable if the user dismisses early.
                if !presented {
                    emphasizeCreatePersona = false
                }
            }
            .onChange(of: store.status?.version) { _, version in
                guard version != nil else { return }
                Task { await loadSharedAppDataIfConnected() }
            }
            .onChange(of: store.isServerRestarting) { wasRestarting, isRestarting in
                if isRestarting {
                    hasCompletedInitialLoad = false
                }
                guard wasRestarting, !isRestarting, store.status != nil else { return }
                Task {
                    await refreshSharedAppDataIfConnected()
                    permissionsStore.refresh()
                    hasCompletedInitialLoad = store.isServerReady
                }
            }
            .task {
                // Keep permissions fresh on appear; initial load also refreshes
                // before marking hasCompletedInitialLoad.
                permissionsStore.refresh()
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
            .coordinateSpace(name: RootContentCoordinateSpace.name)
            .overlay(alignment: .topLeading) {
                if let sidebarActionHelp {
                    SidebarActionHelpPopover(
                        title: sidebarActionHelp.item.title,
                        detail: sidebarActionHelp.item.detail
                    )
                    .frame(width: 260)
                    .position(
                        x: sidebarActionHelp.buttonFrame.maxX + 140,
                        y: sidebarActionHelp.buttonFrame.midY
                    )
                    .allowsHitTesting(false)
                    .transition(.opacity.combined(with: .scale(scale: 0.98, anchor: .leading)))
                    .zIndex(100)
                }
            }
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
                isServerConnecting: store.isServerConnecting,
                serverLifecycleMessage: store.serverLifecycleMessage,
                updateStore: updateStore,
                onSelectRoute: navigateToRoute,
                isPersonaPickerPresented: $isPersonaPickerPresented,
                isPersonaAttentionHighlighted: isPersonaAttentionHighlighted,
                emphasizeCreatePersona: emphasizeCreatePersona,
                onCreatePersona: {
                    clearPersonaAttention()
                    openPersonaEditor(.create)
                },
                onEditPersona: { name in
                    clearPersonaAttention()
                    openPersonaEditor(.edit(name: name))
                },
                onPersonaSelected: {
                    clearPersonaAttention()
                    refreshStatus()
                },
                onCheckForUpdates: {
                    Task { await updateStore.checkNativeAppForUpdates() }
                },
                onRestartServer: {
                    Task { await store.restartServer() }
                },
                onActionHelpChange: { presentation in
                    withAnimation(.easeOut(duration: presentation == nil ? 0.08 : 0.12)) {
                        sidebarActionHelp = presentation
                    }
                },
                sidebarContent: {
                    switch history.current {
                    case .dashboard:
                        DashboardSidebarView(
                            sessions: store.sessions,
                            schedules: schedulesStore.schedules,
                            recordings: recordingsStore.recordings,
                            memories: memoriesStore.memories,
                            isSessionsLoading: store.isSessionsLoading,
                            onOpenSession: { id in
                                navigateToRoute(.chat)
                                selectSession(id)
                            },
                            onOpenScheduleRun: { item in
                                Task {
                                    await schedulesStore.selectSchedule(id: item.schedule.id)
                                    await schedulesStore.selectRun(id: item.run.id)
                                }
                                navigateToRoute(.schedules)
                            },
                            onOpenRecording: openRecording,
                            onOpenMemory: openMemory
                        )
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
                    case .projects:
                        ProjectsSidebarView(
                            store: projectsStore,
                            selectedSessionId: store.sessionId,
                            onCreate: { Task { await projectsStore.createProject(chatStore: store) } },
                            onSelect: { id in
                                Task { await projectsStore.selectProject(id: id, chatStore: store) }
                            },
                            onSelectSession: { id in
                                Task { await projectsStore.selectChat(id: id, chatStore: store) }
                            }
                        )
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
                            activeRecording: store.listenStatus.flatMap { ActiveRecordingInfo($0) },
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
                    case .memories:
                        MemoriesSidebarView(store: memoriesStore, onDelete: { memory in
                            memoriesStore.pendingDelete = MemoriesStore.PendingDelete(
                                id: memory.id, value: memory.value
                            )
                        })
                    case .flows:
                        FlowsSidebarView(store: flowsStore)
                    }
                }
            )
            .navigationSplitViewColumnWidth(AppTheme.sidebarWidth)
        } detail: {
            switch history.current {
            case .dashboard:
                DashboardView(
                    store: dashboardStore,
                    userName: DashboardView.defaultUserName(),
                    onboarding: onboardingChecklist,
                    isOnboardingReady: isOnboardingReady,
                    isServerReady: store.isServerReady,
                    onRefresh: { Task { await refreshDashboardData() } },
                    onSelectRoute: navigateToRoute,
                    onOpenSettings: { openSettings(navKey: $0) },
                    onOpenAIProviderSetup: { isAIProviderChooserPresented = true },
                    onOpenPersonaPicker: focusPersonaPickerFromOnboarding,
                    onOpenPermissions: { openWindow(id: "permissions") },
                    actionContext: DashboardBlockActionContext(
                        startChat: startNewChat,
                        summarizeEmail: summarizeUnreadEmailInChat,
                        planInChat: planCalendarInChat
                    )
                )
                .toolbar {
                    commonToolbarItems()
                    ToolbarItem(placement: .principal) {
                        SessionTitleBadge(
                            title: "Dashboard",
                            activityLine: dashboardUpdatedText,
                        )
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(
                            Capsule()
                                .fill(AppTheme.elevatedBackground.opacity(0.92)),
                        )
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(0.12), lineWidth: 1),
                        )
                        .fixedSize(horizontal: true, vertical: false)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            Task { await refreshDashboardData() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .help("Refresh")
                        .disabled(dashboardStore.isRefreshing)
                        .accessibilityIdentifier("dashboard-refresh-button")
                    }
                }
            case .chat:
                ChatWorkspaceView(store: store)
                    .toolbar {
                        commonToolbarItems()
                        ToolbarItem(placement: .principal) {
                            HStack(spacing: 8) {
                                if let iconUrl = store.resolvedIntegrationIconUrl {
                                    AsyncImage(url: iconUrl) { phase in
                                        switch phase {
                                        case .success(let image):
                                            image
                                                .resizable()
                                                .scaledToFit()
                                        case .failure:
                                            Image(systemName: "arrowshape.turn.up.left")
                                                .font(.system(size: 13, weight: .semibold))
                                                .foregroundStyle(AppTheme.primaryText)
                                        case .empty:
                                            Image(systemName: "arrowshape.turn.up.left")
                                                .font(.system(size: 13, weight: .semibold))
                                                .foregroundStyle(AppTheme.tertiaryText)
                                        @unknown default:
                                            Image(systemName: "arrowshape.turn.up.left")
                                                .font(.system(size: 13, weight: .semibold))
                                                .foregroundStyle(AppTheme.tertiaryText)
                                        }
                                    }
                                    .frame(width: 18, height: 18)
                                }
                                SessionTitleBadge(
                                    title: store.sessionName,
                                    activityLine: store.activityLine,
                                )
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                Capsule()
                                    .fill(AppTheme.elevatedBackground.opacity(0.92)),
                            )
                            .overlay(
                                Capsule()
                                    .stroke(Color.white.opacity(0.12), lineWidth: 1),
                            )
                            .fixedSize(horizontal: true, vertical: false)
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
            case .projects:
                ProjectsView(projectsStore: projectsStore, chatStore: store)
                    .toolbar {
                        commonToolbarItems()
                        ToolbarItem(placement: .principal) {
                            SessionTitleBadge(
                                title: projectsStore.selectedProjectName,
                                activityLine: store.activityLine,
                            )
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                Capsule()
                                    .fill(AppTheme.elevatedBackground.opacity(0.92)),
                            )
                            .overlay(
                                Capsule()
                                    .stroke(Color.white.opacity(0.12), lineWidth: 1),
                            )
                            .fixedSize(horizontal: true, vertical: false)
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button {
                                Task { await projectsStore.createProject(chatStore: store) }
                            } label: {
                                Image(systemName: "plus")
                            }
                            .help("New Project")
                            .disabled(projectsStore.isSaving || store.isLoading)
                        }
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
                RecordingsView(store: recordingsStore, processingState: store.recordingProcessing, validSessionIds: Set(store.sessions.map(\.id)), onStartRecording: toggleRecording, activeRecording: store.listenStatus.flatMap { ActiveRecordingInfo($0) })
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
            case .memories:
                MemoriesView(store: memoriesStore)
                    .toolbar {
                        commonToolbarItems()
                        ToolbarItem(placement: .principal) { Spacer() }
                        ToolbarItem(placement: .confirmationAction) {
                            Button {
                                Task { await memoriesStore.load() }
                            } label: {
                                Image(systemName: "arrow.clockwise")
                            }
                            .help("Refresh memories")
                            .disabled(memoriesStore.isListLoading || memoriesStore.isSaving)
                            .accessibilityIdentifier("refresh-memories-button")
                            .accessibilityLabel("Refresh memories")
                        }
                    }
            case .flows:
                FlowsView(store: flowsStore)
                    .toolbar {
                        commonToolbarItems()
                        ToolbarItem(placement: .principal) { Spacer() }
                        ToolbarItem(placement: .confirmationAction) {
                            Button {
                                Task {
                                    await flowsStore.load()
                                    if flowsStore.selectedFlowId != nil {
                                        await flowsStore.refreshSelectedRuns()
                                    }
                                }
                            } label: {
                                Image(systemName: "arrow.clockwise")
                            }
                            .help("Refresh flows")
                            .disabled(flowsStore.isListLoading || flowsStore.isRunsLoading)
                            .accessibilityIdentifier("refresh-flows-button")
                            .accessibilityLabel("Refresh flows")
                        }
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
            SettingsToolbarButton(onOpenSettings: { openSettings() })
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
        presentCommandPalette()
    }

    private func presentCommandPalette() {
        bringMainWindowToFront()
        CommandPalettePanelController.shared.show {
            CommandPaletteView(
                sessions: store.sessions,
                integrations: integrationsStore.integrationSections,
                schedules: schedulesStore.schedules,
                recordings: recordingsStore.recordings,
                onSelectSession: selectSession,
                onNewChat: startNewChat,
                onOpenSettings: { openSettings() },
                onNavigateToRoute: navigateToRoute,
                onOpenIntegration: openIntegration,
                onOpenSchedule: openSchedule,
                onOpenRecording: openRecording,
                onRestartServer: {
                    Task { await store.restartServer() }
                },
                onDismiss: { CommandPalettePanelController.shared.dismiss() },
            )
            .tobyAppearance(appearancePreferences)
        }
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
        navigateToRoute(.chat)
        Task { await store.startNewSession() }
    }

    private func startNewSchedule() {
        bringMainWindowToFront()
        navigateToRoute(.schedules)
        Task { await schedulesStore.createSchedule() }
    }

    private func startNewProject() {
        bringMainWindowToFront()
        navigateToRoute(.projects)
        Task { await projectsStore.createProject(chatStore: store) }
    }

    private func startNewMemory() {
        bringMainWindowToFront()
        navigateToRoute(.memories)
        memoriesStore.startCreate()
    }

    private func summarizeUnreadEmailInChat() {
        navigateToRoute(.chat)
        Task { await store.startChatWithPrompt("Show me a summary of all my unread email") }
    }

    private func planCalendarInChat() {
        navigateToRoute(.chat)
        Task {
            await store.startChatWithPrompt(
                "Help me plan around my upcoming calendar events for the next week. Summarize what's coming up and what I should prepare for."
            )
        }
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

    private func continueLongRecording() {
        longRecordingPromptCoordinator.continueRecording(now: Date())
    }

    private func stopLongRecordingFromPrompt() {
        handleLongRecordingPromptAction(longRecordingPromptCoordinator.stopRecording())
    }

    private func navigateToRoute(_ route: DetailRoute) {
        history.navigate(to: route)
    }

    /// Onboarding must wait until the daemon handshake and first shared data
    /// load finish; otherwise empty stores make every step look incomplete and
    /// the card flashes then vanishes.
    private var isOnboardingReady: Bool {
        hasCompletedInitialLoad
            && store.isServerReady
            && permissionsStore.hasRefreshedOnce
    }

    private var onboardingChecklist: OnboardingChecklist {
        let hasAIProvider = store.status?.hasConfiguredAIProvider ?? false
        let connected = !(store.status?.connectedIntegrations?.isEmpty ?? true)
        let hasCustomPersona = (store.status?.personaCount ?? 1) > 1
        let granted = Set(
            permissionsStore.statuses.filter(\.isGranted).map(\.kind)
        )
        let requiredPermissions = granted.contains(.microphone) && granted.contains(.screenCapture)
        let tx = store.status?.transcription
        return OnboardingChecklist.make(
            hasConfiguredAIProvider: hasAIProvider,
            hasConnectedIntegrations: connected,
            hasModelConfigured: hasCustomPersona,
            hasRequiredPermissions: requiredPermissions,
            hasSchedule: !schedulesStore.schedules.isEmpty,
            hasSkill: !skillsStore.skills.isEmpty,
            hasTranscriptionConfigured: tx?.configured ?? false,
            transcriptionNeedsApiKey: tx?.needsApiKey ?? false,
            transcriptionProviderLabel: tx?.provider,
            hasRecording: !recordingsStore.recordings.isEmpty,
            hasSession: !store.sessions.isEmpty
        )
    }

    private var dashboardUpdatedText: String {
        guard let lastLoadedAt = dashboardStore.lastLoadedAt else { return "" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return "Updated \(formatter.localizedString(for: lastLoadedAt, relativeTo: Date()))"
    }

    private func openSettings(navKey: String? = nil) {
        if let navKey {
            // Prefer top-level tab selection once sections are loaded (so nested
            // containers like AI land on the tab + first child). Otherwise seed
            // selectedNavKey so loadSettingsSections / syncTabFromStoreSelection
            // pick the right tab after the window opens.
            if configureStore.isSettingsMode {
                let isTopLevel = configureStore.settingsSections.contains {
                    ConfigureTreeHelpers.sectionIdentityKey($0) == navKey
                }
                if isTopLevel {
                    configureStore.selectTopLevelTab(navKey)
                } else {
                    configureStore.selectSection(navKey)
                }
            } else {
                configureStore.selectedNavKey = navKey
            }
        }
        openWindow(id: "settings")
    }

    /// Opens the sidebar persona popover and briefly pulses the control so the
    /// onboarding "Set up persona" step points at the right place.
    private func focusPersonaPickerFromOnboarding() {
        bringMainWindowToFront()
        // Ensure the main sidebar (with the persona footer) is visible.
        if sidebarVisibility == .detailOnly {
            sidebarVisibility = .all
        }
        isPersonaPickerPresented = true
        emphasizeCreatePersona = true
        isPersonaAttentionHighlighted = true
        personaAttentionTask?.cancel()
        personaAttentionTask = Task {
            try? await Task.sleep(for: .seconds(4.5))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                isPersonaAttentionHighlighted = false
            }
        }
    }

    private func clearPersonaAttention() {
        personaAttentionTask?.cancel()
        personaAttentionTask = nil
        isPersonaAttentionHighlighted = false
        emphasizeCreatePersona = false
    }

    private func openIntegration(navKey: String) {
        integrationsStore.selectedNavKey = navKey
        navigateToRoute(.integrations)
    }

    private func openSchedule(id: String) {
        Task { await schedulesStore.selectSchedule(id: id) }
        navigateToRoute(.schedules)
    }

    private func openScheduleFromNotification(id: String) {
        bringMainWindowToFront()
        navigateToRoute(.schedules)
        Task {
            await schedulesStore.load()
            await schedulesStore.selectSchedule(id: id)
        }
    }

    private func openRecording(id: String) {
        Task { await recordingsStore.selectRecording(id: id) }
        navigateToRoute(.recordings)
    }

    private func openMemory(id: String) {
        Task { await memoriesStore.selectMemory(id: id) }
        navigateToRoute(.memories)
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

    private func loadSharedAppDataIfConnected() async {
        guard store.status != nil else { return }
        async let sessions: () = store.refreshSessions()
        async let schedules: () = schedulesStore.ensureLoaded()
        async let recordings: () = recordingsStore.ensureListLoaded()
        async let memories: () = memoriesStore.ensureListLoaded()
        async let skills: () = skillsStore.ensureListLoaded()
        async let projects: () = projectsStore.ensureListLoaded()
        async let integrations: () = loadIntegrationsIfNeeded()
        _ = await (sessions, schedules, recordings, memories, skills, projects, integrations)
    }

    private func refreshSharedAppDataIfConnected() async {
        guard store.status != nil else { return }
        async let sessions: () = store.refreshSessions()
        async let schedules: () = schedulesStore.load()
        async let recordings: () = recordingsStore.loadList()
        async let memories: () = memoriesStore.loadList()
        async let skills: () = skillsStore.loadList()
        async let projects: () = projectsStore.loadList()
        async let integrations: () = integrationsStore.load()
        _ = await (sessions, schedules, recordings, memories, skills, projects, integrations)
    }

    private func refreshDashboardData() async {
        // Force every registered block (bypasses server caches; awaits AI).
        // Shared app stores refresh in parallel but do not gate the spinner.
        async let dashboard: () = dashboardStore.refreshAll()
        async let shared: () = refreshSharedAppDataIfConnected()
        _ = await (dashboard, shared)
    }

    private func loadIntegrationsIfNeeded() async {
        guard integrationsStore.tree == nil else { return }
        await integrationsStore.load()
    }

    private func presentAbout() {
        Task {
            await store.refreshStatus()
            isAboutPresented = true
        }
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

    private func longRecordingPromptLoop() async {
        while !Task.isCancelled {
            updateLongRecordingPromptState(now: Date())
            try? await Task.sleep(for: .seconds(1))
        }
    }

    private func updateLongRecordingPromptState(now: Date) {
        longRecordingPromptCoordinator.updateRecordingStatus(
            isActive: store.isRecordingActive,
            sessionId: store.listenStatus?.session?.id,
            startedAt: store.listenStatus?.session?.startedAt
        )
        if let action = longRecordingPromptCoordinator.advance(now: now) {
            handleLongRecordingPromptAction(action)
        }
    }

    private func handleLongRecordingPromptAction(_ action: LongRecordingPromptAction) {
        switch action {
        case .present:
            bringMainWindowToFront()
        case .stop:
            Task { await store.stopActiveRecording() }
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
                hasConfiguredAIProvider: currentStatus?.hasConfiguredAIProvider,
                tobyDir: currentStatus?.tobyDir,
                contextWindow: currentStatus?.contextWindow,
                personaImageUrl: currentStatus?.personaImageUrl,
                connectedIntegrations: currentStatus?.connectedIntegrations,
                personaCount: currentStatus?.personaCount,
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
    static let startNewSchedule = Notification.Name("startNewSchedule")
    static let startNewProject = Notification.Name("startNewProject")
    static let startNewMemory = Notification.Name("startNewMemory")
    static let startChatAboutRecording = Notification.Name("startChatAboutRecording")
    static let showChatSession = Notification.Name("showChatSession")
    static let secondaryWindowClosed = Notification.Name("secondaryWindowClosed")
    static let menuBarToggleRecording = Notification.Name("menuBarToggleRecording")
    static let navigateToRoute = Notification.Name("navigateToRoute")
    static let openSettingsWindow = Notification.Name("openSettingsWindow")
    static let openScheduleFromNotification = Notification.Name("openScheduleFromNotification")
    static let backupConfig = Notification.Name("backupConfig")
    static let restoreConfig = Notification.Name("restoreConfig")
    /// Posted when chat (or another writer) mutates durable memory so the memories UI can refresh.
    static let memoriesDidChange = Notification.Name("toby.memoriesDidChange")
    static let personasDidChange = Notification.Name("toby.personasDidChange")
}

struct RestoreBackupSelection: Identifiable {
    let id = UUID()
    let url: URL
}

struct StartChatAboutRecordingRequest {
    let recordingId: String
    let name: String
    let dateText: String
    let hourText: String
}

struct OpenScheduleFromNotificationRequest {
    let scheduleId: String
}
