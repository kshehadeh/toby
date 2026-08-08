import AppKit
import SwiftUI

struct RootView: View {
    @Bindable var store: ChatStore
    @Bindable var dashboardStore: DashboardStore
    @Bindable var configureStore: ConfigureStore
    @Bindable var recordingsStore: RecordingsStore
    @Bindable var schedulesStore: SchedulesStore
    @Bindable var projectsStore: ProjectsStore
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

    var body: some View {
        contentWithBackup
            .modifier(rootNotificationRouter)
    }

    private var rootNotificationRouter: RootNotificationRouter {
        RootNotificationRouter(
            onStartNewSchedule: startNewSchedule,
            onStartNewProject: startNewProject,
            onStartNewMemory: startNewMemory,
            onMemoriesDidChange: { memoriesStore.handleExternalMemoryChange() },
            onPersonasDidChange: {
                Task {
                    await configureStore.handlePersonasChanged()
                    await schedulesStore.refreshPersonas()
                    await projectsStore.refreshPersonas()
                }
            },
            onSkillsDidChange: { skillsStore.handleExternalSkillChange() },
            onTobyHomeDidChange: {
                Task { await handleTobyHomeDidChange() }
            },
            onBackupConfig: {
                bringMainWindowToFront()
                isBackupSheetPresented = true
            },
            onRestoreConfig: {
                bringMainWindowToFront()
                if let url = ConfigBackupFilePanels.presentOpenPanel() {
                    restoreSelection = RestoreBackupSelection(url: url)
                }
            },
            onOpenCommandPalette: { presentCommandPalette(activateApplication: true) },
            onOpenIssueReport: { isIssueReportPresented = true },
            onOpenChangelog: presentAbout,
            onOpenRecording: openRecording,
            onOpenScheduleFromNotification: openScheduleFromNotification,
            onStartNewChat: {
                bringMainWindowToFront()
                startNewChat()
            },
            onToggleRecording: toggleRecording,
            onSecondaryWindowClosed: bringMainWindowToFront,
            onStartChatAboutRecording: { request in
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
            },
            onShowChatSession: { sessionId in
                bringMainWindowToFront()
                navigateToRoute(.chat)
                Task { await store.selectSession(id: sessionId) }
            },
            onNavigateToRoute: navigateToRoute,
            onOpenSettings: { openSettings(navKey: $0) },
            isRecordingActive: store.isRecordingActive,
            recordingProcessingStage: store.recordingProcessing?.stage,
            recordingProcessingRecordingId: store.recordingProcessing?.recordingId,
            onRefreshRecordingsAfterProcessing: { recordingId in
                Task {
                    await recordingsStore.refreshAfterRecordingProcessing(recordingId: recordingId)
                }
            }
        )
    }

    /// Backup / restore sheets (notification entry points live on the router).
    private var contentWithBackup: some View {
        contentWithAlerts
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
        contentWithSheets
            .background(WindowAccessor { window in
                mainWindow = window
            })
            .onAppear {
                configureStore.onChangesSaved = { Task { await store.refreshStatus() } }
                integrationsStore.onChangesSaved = { Task { await store.refreshStatus() } }
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
            .overlay(alignment: .bottomTrailing) {
                AppToastHost(store: store, onAction: handleToastAction)
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
                isRecordingActive: store.isRecordingActive,
                updateStore: updateStore,
                onSelectRoute: navigateToRoute,
                isPersonaPickerPresented: $isPersonaPickerPresented,
                isPersonaAttentionHighlighted: isPersonaAttentionHighlighted,
                emphasizeCreatePersona: emphasizeCreatePersona,
                onCreatePersona: {
                    clearPersonaAttention()
                    openSettings(navKey: SettingsItem.personasSectionKey)
                },
                onEditPersona: { name in
                    clearPersonaAttention()
                    openSettings(navKey: SettingsItem.personasSectionKey, personaName: name)
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
                    RootToolbars.dashboard(
                        common: commonToolbarModel,
                        updatedText: RootToolbars.dashboardUpdatedText(
                            lastLoadedAt: dashboardStore.lastLoadedAt
                        ),
                        isRefreshing: dashboardStore.isRefreshing,
                        onRefresh: { Task { await refreshDashboardData() } }
                    )
                }
            case .chat:
                ChatWorkspaceView(store: store)
                    .toolbar {
                        RootToolbars.chat(
                            common: commonToolbarModel,
                            sessionName: store.sessionName,
                            activityLine: store.activityLine,
                            integrationIconUrl: store.resolvedIntegrationIconUrl,
                            isLoading: store.isLoading,
                            onNewChat: startNewChat
                        )
                    }
            case .integrations:
                IntegrationsView(store: integrationsStore)
                    .toolbar {
                        RootToolbars.integrations(common: commonToolbarModel)
                    }
            case .projects:
                ProjectsView(projectsStore: projectsStore, chatStore: store)
                    .toolbar {
                        RootToolbars.projects(
                            common: commonToolbarModel,
                            selectedProjectName: projectsStore.selectedProjectName,
                            activityLine: store.activityLine,
                            isSaving: projectsStore.isSaving,
                            isChatLoading: store.isLoading,
                            onNewProject: {
                                Task { await projectsStore.createProject(chatStore: store) }
                            }
                        )
                    }
            case .schedules:
                SchedulesView(store: schedulesStore)
                    .toolbar {
                        RootToolbars.schedules(
                            common: commonToolbarModel,
                            hasSelection: schedulesStore.selectedSchedule != nil,
                            isRunning: schedulesStore.runningScheduleId != nil,
                            isDeleting: schedulesStore.deletingScheduleId != nil,
                            onRun: {
                                guard let id = schedulesStore.selectedSchedule?.id else { return }
                                Task { await schedulesStore.runSchedule(id: id) }
                            },
                            onDelete: {
                                guard let schedule = schedulesStore.selectedSchedule else { return }
                                schedulesStore.pendingDelete = SchedulesStore.PendingDelete(
                                    scheduleId: schedule.id,
                                    title: schedule.displayName
                                )
                            }
                        )
                    }
            case .recordings:
                RecordingsView(store: recordingsStore, processingState: store.recordingProcessing, validSessionIds: Set(store.sessions.map(\.id)), onStartRecording: toggleRecording, onStopRecording: toggleRecording, activeRecording: store.listenStatus.flatMap { ActiveRecordingInfo($0) })
                    .toolbar {
                        RootToolbars.recordings(
                            common: commonToolbarModel,
                            hasSelection: !recordingsStore.selectedRecordings.isEmpty,
                            deleteHelp: RootToolbars.recordingsDeleteHelp(
                                selectedCount: recordingsStore.selectedRecordings.count
                            ),
                            isDeleting: recordingsStore.isDeletingSelection,
                            onDelete: {
                                recordingsStore.pendingDeleteRecordingIds = Set(
                                    recordingsStore.selectedRecordings.map(\.id)
                                )
                            }
                        )
                    }
            case .skills:
                SkillsView(store: skillsStore)
                    .toolbar {
                        RootToolbars.skills(
                            common: commonToolbarModel,
                            hasSelection: skillsStore.selectedSkill != nil,
                            isSaving: skillsStore.isSaving,
                            onDelete: {
                                guard let skill = skillsStore.selectedSkill else { return }
                                skillsStore.pendingDelete = SkillsStore.PendingDelete(
                                    dirName: skill.dirName,
                                    name: skill.name
                                )
                            }
                        )
                    }
            case .memories:
                MemoriesView(store: memoriesStore)
                    .toolbar {
                        RootToolbars.memories(
                            common: commonToolbarModel,
                            isListLoading: memoriesStore.isListLoading,
                            isSaving: memoriesStore.isSaving,
                            onRefresh: { Task { await memoriesStore.load() } }
                        )
                    }
            case .flows:
                FlowsView(store: flowsStore)
                    .toolbar {
                        RootToolbars.flows(
                            common: commonToolbarModel,
                            isListLoading: flowsStore.isListLoading,
                            isRunsLoading: flowsStore.isRunsLoading,
                            onRefresh: {
                                Task {
                                    await flowsStore.load()
                                    if flowsStore.selectedFlowId != nil {
                                        await flowsStore.refreshSelectedRuns()
                                    }
                                }
                            }
                        )
                    }
            }
        }
    }

    private var commonToolbarModel: RootCommonToolbarModel {
        RootCommonToolbarModel(
            isRecordingActive: store.isRecordingActive,
            isRecordButtonDisabled: store.isRecordButtonDisabled,
            canGoBack: history.canGoBack,
            canGoForward: history.canGoForward,
            onToggleRecording: toggleRecording,
            onSearch: { presentCommandPalette() },
            onOpenSettings: { openSettings() },
            onBack: { _ = history.goBack() },
            onForward: { _ = history.goForward() }
        )
    }

    private func presentCommandPalette(activateApplication: Bool = false) {
        if activateApplication {
            NSApp.activate(ignoringOtherApps: true)
        }
        // Show the palette without activating Toby or bringing the main window
        // forward unless it was summoned by the global shortcut — the panel is
        // non-activating, like Spotlight. Each action
        // callback surfaces the relevant window when the user picks something.
        CommandPalettePanelController.shared.show {
            CommandPaletteView(
                sessions: store.sessions,
                integrations: integrationsStore.integrationSections,
                schedules: schedulesStore.schedules,
                recordings: recordingsStore.recordings,
                onSelectSession: { id in
                    bringMainWindowToFront()
                    selectSession(id)
                },
                onNewChat: {
                    bringMainWindowToFront()
                    startNewChat()
                },
                onOpenSettings: {
                    bringMainWindowToFront()
                    openSettings()
                },
                onNavigateToRoute: { route in
                    bringMainWindowToFront()
                    navigateToRoute(route)
                },
                onOpenIntegration: { navKey in
                    bringMainWindowToFront()
                    openIntegration(navKey: navKey)
                },
                onOpenSchedule: { id in
                    bringMainWindowToFront()
                    openSchedule(id: id)
                },
                onOpenRecording: { id in
                    bringMainWindowToFront()
                    openRecording(id: id)
                },
                onStartChat: { prompt in
                    bringMainWindowToFront()
                    navigateToRoute(.chat)
                    Task { await store.startNewChat(withPrompt: prompt) }
                },
                onRestartServer: {
                    Task { await store.restartServer() }
                },
                onDismiss: { CommandPalettePanelController.shared.dismiss() },
            )
            .tobyAppearance(appearancePreferences)
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

    private func openSettings(navKey: String? = nil, personaName: String? = nil) {
        RootSettingsNavigation.prepare(
            configureStore: configureStore,
            navKey: navKey,
            personaName: personaName
        )
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
        Task {
            // Always reload the list so a recording finished off-route appears
            // in the sidebar before we select it.
            await recordingsStore.refreshAfterRecordingProcessing(recordingId: id)
        }
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

    /// Soft-reset feature stores after Settings → General switches the Toby home.
    private func handleTobyHomeDidChange() async {
        hasCompletedInitialLoad = false
        history.resetToDashboard()

        dashboardStore.resetForHomeSwitch()
        configureStore.resetForHomeSwitch()
        integrationsStore.resetForHomeSwitch()
        recordingsStore.resetForHomeSwitch()
        schedulesStore.resetForHomeSwitch()
        projectsStore.resetForHomeSwitch()
        skillsStore.resetForHomeSwitch()
        memoriesStore.resetForHomeSwitch()
        flowsStore.resetForHomeSwitch()
        pluginsStore.resetForHomeSwitch()
        changelogStore.resetForHomeSwitch()

        await refreshSharedAppDataIfConnected()
        await dashboardStore.refreshAll()
        await configureStore.loadSettingsSections()
        await integrationsStore.loadSettingsSections()
        await pluginsStore.load()
        permissionsStore.refresh()
        hasCompletedInitialLoad = store.isServerReady
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

    private func longRecordingPromptLoop() async {
        while !Task.isCancelled {
            updateLongRecordingPromptState(now: Date())
            try? await Task.sleep(for: .seconds(1))
        }
    }

    private func updateLongRecordingPromptState(now: Date) {
        // Only treat capture as live for the long-recording prompt. While stop
        // is in flight or post-stop processing/transcription runs, listenStatus
        // can still report active until native stop returns — do not re-prompt.
        let isLiveCapture = store.isRecordingActive
            && !store.isListenRequestInFlight
            && store.recordingProcessing == nil
        longRecordingPromptCoordinator.updateRecordingStatus(
            isActive: isLiveCapture,
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
