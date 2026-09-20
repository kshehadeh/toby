import AppKit
import SwiftUI

struct RootView: View {
    @Bindable var store: ChatStore
    @Bindable var dashboardStore: DashboardStore
    @Bindable var configureStore: ConfigureStore
    @Bindable var recordingsStore: RecordingsStore
    @Bindable var schedulesStore: SchedulesStore
    @Bindable var projectsStore: ProjectsStore
    @Bindable var skillsStore: SkillsStore
    @Bindable var memoriesStore: MemoriesStore
    @Bindable var flowsStore: FlowsStore
    let personaEditorCoordinator: PersonaEditorCoordinator
    @Bindable var updateStore: UpdateStore
    @Bindable var changelogStore: ChangelogStore
    @Bindable var pluginsStore: PluginsStore
    @Environment(\.openWindow) private var openWindow
    @Bindable var appearancePreferences: AppearancePreferences = .shared
    @State private var permissionsStore = PermissionsStore()
    @State private var history = NavigationHistory()
    @State private var isIssueReportPresented = false
    @State private var isAboutPresented = false
    @State private var isBackupSheetPresented = false
    @State private var restoreSelection: RestoreBackupSelection?
    @State private var pendingDeleteSession: SessionSummary?
    @State private var sidebarVisibility: NavigationSplitViewVisibility = .all
    @State private var mainWindow: NSWindow?

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
    /// When true on a narrow Chats workspace, show the session list instead of the transcript.
    @State private var preferChatSessionList = false
    @State private var isConnectionStatusPresented = false

    var body: some View {
        contentWithBackup
            .modifier(rootNotificationRouter)
            .onChange(of: history.current) { _, _ in
                leaveProjectSessionIfMainChatVisible()
            }
            .onChange(of: store.isLoading) { _, _ in
                leaveProjectSessionIfMainChatVisible()
            }
            .onChange(of: store.sessionProjectId) { _, _ in
                leaveProjectSessionIfMainChatVisible()
            }
    }

    private var rootNotificationRouter: RootNotificationRouter {
        RootNotificationRouter(
            onStartNewSchedule: startNewSchedule,
            onStartNewSkill: startNewSkill,
            onStartNewProject: startNewProject,
            onStartNewMemory: startNewMemory,
            onMemoriesDidChange: { memoriesStore.handleExternalMemoryChange() },
            onPersonasDidChange: {
                Task {
                    await configureStore.handlePersonasChanged()
                    await schedulesStore.refreshPersonas()
                    await projectsStore.refreshPersonas()
                    await store.refreshPersonas()
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
            onStartChatAboutRecording: startChatAboutRecording,
            onShowChatSession: showChatSession,
            onNavigateToRoute: navigateToRoute,
            onOpenSettings: { openSettings(navKey: $0) },
            onOpenMemoriesWindow: { openWindow(id: "memories") },
            onOpenConnectionStatus: {
                bringMainWindowToFront()
                isConnectionStatusPresented = true
            },
            isRecordingActive: store.isRecordingActive,
            recordingChromeState: store.recordingChromeState,
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
                            title: "Toby data restored",
                            message: "Settings, credentials, chats, memories, project files, and recordings were restored from the backup."
                        )
                        Task {
                            await store.refreshStatus()
                            await configureStore.loadSettingsSections()
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
            .sheet(isPresented: $isConnectionStatusPresented) {
                ServerInfoView(
                    status: store.status,
                    daemonStatus: store.daemonStatus,
                    health: ServerHealth.resolve(
                        status: store.status,
                        daemonStatus: store.daemonStatus,
                        isRestarting: store.isServerRestarting,
                        isConnecting: store.isServerConnecting
                    ),
                    isRestarting: store.isServerRestarting || store.isServerConnecting,
                    lifecycleMessage: store.serverLifecycleMessage,
                    onRestart: { Task { await store.restartServer() } },
                    onDismiss: { isConnectionStatusPresented = false }
                )
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
    }

    private var contentWithOverlay: some View {
        routeContent
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
                onSelectRoute: { route in
                    if route == history.current {
                        showRouteOverviewIfNeeded(route)
                    } else {
                        navigateToRoute(route)
                    }
                },
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
                onRestartServer: {
                    Task { await store.restartServer() }
                }
            )
            .navigationSplitViewColumnWidth(AppTheme.sidebarWidth)
        } detail: {
            detailWorkspace
        }
        .navigationTitle(rootNavigationTitle)
        .navigationSubtitle(rootNavigationSubtitle)
        .toolbar { rootToolbar }
        .onChange(of: history.current) { _, route in
            if route != .chat {
                preferChatSessionList = false
            }
        }
    }

    @ViewBuilder
    private var detailWorkspace: some View {
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
                onCreateSchedule: startNewSchedule,
                onCreateSkill: startNewSkill,
                recentWork: DashboardRecentWorkItem.merged(
                    sessions: store.sessions,
                    projects: projectsStore.projects
                ),
                isRecentWorkLoading: store.isSessionsLoading || projectsStore.isLoading,
                onSelectRecentWork: openRecentWork,
                onOpenSettings: { openSettings(navKey: $0) },
                onOpenAIProviderSetup: { isAIProviderChooserPresented = true },
                onOpenPersonaPicker: focusPersonaPickerFromOnboarding,
                onOpenPermissions: { openWindow(id: "permissions") },
                actionContext: DashboardBlockActionContext(
                    startChat: startNewChat,
                    summarizeEmail: summarizeUnreadEmailInChat,
                    planInChat: planCalendarInChat,
                    openFlow: openDashboardFlow,
                    runFlow: runDashboardFlow
                )
            )
            .sheet(isPresented: Binding(
                get: { flowsStore.showResultSheet },
                set: { if !$0 { flowsStore.closeResultSheet() } }
            )) {
                FlowResultSheet(result: flowsStore.lastRunResult) {
                    flowsStore.closeResultSheet()
                }
            }
        case .chat:
            ChatWorkspaceSplit(
                store: store,
                preferSessionList: $preferChatSessionList,
                onSelectSession: { id in
                    selectSession(id)
                },
                onDeleteSession: { pendingDeleteSession = $0 }
            )
        case .projects:
            ProjectsView(projectsStore: projectsStore, chatStore: store)
        case .schedules:
            SchedulesView(store: schedulesStore, onOpenFlow: openDashboardFlow)
        case .recordings:
            RecordingsView(
                store: recordingsStore,
                processingState: store.recordingProcessing,
                onStartRecording: toggleRecording,
                onStopRecording: toggleRecording,
                activeRecording: store.listenStatus.flatMap { ActiveRecordingInfo($0) }
            )
        case .skills:
            SkillsView(store: skillsStore)
        case .flows:
            FlowsView(store: flowsStore)
        }
    }

    @ToolbarContentBuilder
    private var rootToolbar: some ToolbarContent {
        switch history.current {
            case .dashboard:

                                    RootToolbars.dashboard(
                                        common: commonToolbarModel,
                                        isRefreshing: dashboardStore.isRefreshing,
                                        showActionsToggle: dashboardStore.blocks.contains {
                                            $0.descriptor.isFlowRunner
                                        },
                                        actionsVisible: appearancePreferences.dashboardLayout.actionsVisible,
                                        onToggleActions: {
                                            withAnimation(DashboardSectionMotion.animation) {
                                                appearancePreferences.toggleDashboardActionsVisible()
                                            }
                                        },
                                        onRefresh: { Task { await refreshDashboardData() } }
                                    )

            case .chat:

                                        RootToolbars.chat(
                                            common: commonToolbarModel,
                                            sessionName: store.sessionId == nil ? "" : store.sessionName,
                                            activityLine: store.activityLine,
                                            integrationIconUrl: store.resolvedIntegrationIconUrl,
                                            isLoading: store.isLoading,
                                            personas: store.personaOptions,
                                            onNewChat: { startNewChat(persona: $0) }
                                        )

            case .projects:

                                        RootToolbars.projects(
                                            common: commonToolbarModel,
                                            selectedProjectName: projectsStore.selectedProjectName,
                                            sessionName: store.sessionName,
                                            activityLine: projectsStore.isShowingChat ? store.activityLine : "",
                                            isSaving: projectsStore.isSaving,
                                            isChatLoading: store.isLoading,
                                            isShowingChat: projectsStore.isShowingChat,
                                            hasSelection: projectsStore.selectedProjectId != nil,
                                            onNewProject: {
                                                projectsStore.startCreate()
                                            },
                                            onNewChat: {
                                                Task { await projectsStore.createChat(chatStore: store) }
                                            },
                                            onEdit: {
                                                projectsStore.startEdit()
                                            },
                                            onDelete: {
                                                guard let project = projectsStore.selectedProject else { return }
                                                projectsStore.pendingDelete = ProjectsStore.PendingDelete(
                                                    projectId: project.id,
                                                    name: project.name
                                                )
                                            },
                                            onReturnToProject: {
                                                projectsStore.showProjectHome()
                                            },
                                            isFilesSidebarPresented: projectsStore.isFilesSidebarPresented,
                                            onToggleFilesSidebar: {
                                                projectsStore.isFilesSidebarPresented.toggle()
                                            }
                                        )

            case .schedules:

                                        RootToolbars.schedules(
                                            common: commonToolbarModel,
                                            title: RootToolbars.routeTitle(
                                                .schedules,
                                                selectedItemName: scheduleNavigationName
                                            ),
                                            hasSelection: schedulesStore.selectedSchedule != nil,
                                            isSaving: schedulesStore.isSaving,
                                            isRunning: schedulesStore.runningScheduleId != nil,
                                            isDeleting: schedulesStore.deletingScheduleId != nil,
                                            onNew: {
                                                schedulesStore.startCreate()
                                            },
                                            onEdit: {
                                                schedulesStore.startEdit()
                                            },
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

            case .recordings:

                                        RootToolbars.recordings(
                                            common: commonToolbarModel,
                                            title: RootToolbars.recordingsNavigationTitle(
                                                recording: recordingsStore.selectedRecording,
                                                selectedCount: recordingsStore.selectedRecordings.count
                                            ),
                                            hasSelection: !recordingsStore.selectedRecordings.isEmpty,
                                            hasSingleSelection: recordingsStore.selectedRecording != nil,
                                            existingChatSessionId: existingRecordingChatSessionId(
                                                chatSessionId: recordingsStore.detail?.metadata.chatSessionId,
                                                validSessionIds: Set(store.sessions.map(\.id))
                                            ),
                                            hasAudio: selectedRecordingHasAudio,
                                            hasTranscript: selectedRecordingHasTranscript,
                                            hasSummary: selectedRecordingHasSummary,
                                            isTranscribing: isSelectedRecordingTranscribing,
                                            isSummarizing: recordingsStore.summarizingRecordingId != nil,
                                            isDeletingAudio: recordingsStore.deletingAudioRecordingId != nil,
                                            deleteHelp: RootToolbars.recordingsDeleteHelp(
                                                selectedCount: recordingsStore.selectedRecordings.count
                                            ),
                                            isDeleting: recordingsStore.isDeletingSelection,
                                            onDelete: {
                                                recordingsStore.pendingDeleteRecordingIds = Set(
                                                    recordingsStore.selectedRecordings.map(\.id)
                                                )
                                            },
                                            onStartChat: startChatAboutSelectedRecording,
                                            onShowChat: showChatForSelectedRecording,
                                            onEdit: { recordingsStore.isEditSheetPresented = true },
                                            onTranscribe: transcribeSelectedRecording,
                                            onSummarize: summarizeSelectedRecording,
                                            onDeleteAudio: {
                                                recordingsStore.pendingDeleteAudioRecordingId =
                                                    recordingsStore.selectedRecording?.id
                                            }
                                        )

            case .skills:

                                        RootToolbars.skills(
                                            common: commonToolbarModel,
                                            title: RootToolbars.routeTitle(
                                                .skills,
                                                selectedItemName: skillNavigationName
                                            ),
                                            hasSelection: skillsStore.selectedSkill != nil,
                                            isSaving: skillsStore.isSaving,
                                            onNew: {
                                                skillsStore.startCreate()
                                            },
                                            onEdit: {
                                                skillsStore.startEdit()
                                            },
                                            onDelete: {
                                                guard let skill = skillsStore.selectedSkill else { return }
                                                skillsStore.pendingDelete = SkillsStore.PendingDelete(
                                                    dirName: skill.dirName,
                                                    name: skill.name
                                                )
                                            }
                                        )

            case .flows:

                                        RootToolbars.flows(
                                            common: commonToolbarModel,
                                            title: RootToolbars.flowsNavigationTitle(
                                                selectedName: flowsStore.selectedFlow?.displayName
                                            ),
                                            isListLoading: flowsStore.isListLoading,
                                            isRunsLoading: flowsStore.isRunsLoading,
                                            hasSelection: flowsStore.selectedFlow != nil,
                                            canEdit: flowsStore.selectedFlow?.builtin == false,
                                            canRun: flowsStore.selectedFlow?.builtin == false,
                                            canDelete: flowsStore.selectedFlow?.builtin == false,
                                            isRunning: flowsStore.isRunning,
                                            onNewFlow: {
                                                Task { await flowsStore.startCreate() }
                                            },
                                            onRefresh: {
                                                Task {
                                                    await flowsStore.load()
                                                }
                                            },
                                            onEdit: {
                                                guard let flow = flowsStore.selectedFlow, !flow.builtin else { return }
                                                Task { await flowsStore.startEdit(id: flow.id) }
                                            },
                                            onRun: {
                                                Task { await flowsStore.runSelected() }
                                            },
                                            onDelete: {
                                                guard let flow = flowsStore.selectedFlow, !flow.builtin else { return }
                                                flowsStore.confirmDelete(id: flow.id)
                                            }
                                        )

        }
    }

    private var rootNavigationTitle: String {
        switch history.current {
        case .dashboard:
            "Home"
        case .chat:
            RootToolbars.routeTitle(.chat, selectedItemName: store.sessionId == nil ? "" : store.sessionName)
        case .projects:
            RootToolbars.routeTitle(
                .projects,
                selectedItemName: projectsStore.isShowingChat ? store.sessionName : projectsStore.selectedProjectName
            )
        case .schedules:
            RootToolbars.routeTitle(
                .schedules,
                selectedItemName: scheduleNavigationName
            )
        case .recordings:
            RootToolbars.recordingsNavigationTitle(
                recording: recordingsStore.selectedRecording,
                selectedCount: recordingsStore.selectedRecordings.count
            )
        case .skills:
            RootToolbars.routeTitle(.skills, selectedItemName: skillNavigationName)
        case .flows:
            RootToolbars.flowsNavigationTitle(
                selectedName: flowsStore.selectedFlow?.displayName
            )
        }
    }

    private var rootNavigationSubtitle: String {
        switch history.current {
        case .dashboard:
            ""
        case .chat:
            store.activityLine
        case .projects:
            RootToolbars.projectsNavigationSubtitle(
                project: projectsStore.selectedProject,
                isShowingChat: projectsStore.isShowingChat,
                chatActivityLine: store.activityLine,
                chatCount: projectsStore.selectedProjectSessions.count,
                personaOptions: projectsStore.personaOptions
            )
        case .recordings:
            RootToolbars.recordingsNavigationSubtitle(
                recording: recordingsStore.selectedRecording,
                selectedCount: recordingsStore.selectedRecordings.count
            )
        case .schedules:
            scheduleNavigationSubtitle
        case .skills:
            skillNavigationSubtitle
        case .flows:
            RootToolbars.flowsNavigationSubtitle(
                flowsStore.selectedFlow
            )
        }
    }

    private var scheduleNavigationName: String? {
        schedulesStore.selectedSchedule?.displayName
    }

    private var skillNavigationName: String? {
        skillsStore.selectedSkill?.name
    }

    private var scheduleNavigationSubtitle: String {
        guard let schedule = schedulesStore.selectedSchedule else { return "" }
        return RootToolbars.schedulesNavigationSubtitle(
            isEnabled: schedule.enabled,
            nextRunText: schedule.nextRunText
        )
    }

    private var skillNavigationSubtitle: String {
        guard let skill = skillsStore.selectedSkill else { return "" }
        return RootToolbars.skillsNavigationSubtitle(
            isEnabled: skill.enabled,
            updatedAt: skill.updatedAt,
            createdAt: skill.createdAt
        )
    }

    private var commonToolbarModel: RootCommonToolbarModel {
        RootCommonToolbarModel(
            isRecordingActive: store.isRecordingActive,
            isRecordingProcessing: store.isRecordingProcessing,
            isRecordButtonDisabled: store.isRecordButtonDisabled,
            canGoBack: history.canGoBack,
            canGoForward: history.canGoForward,
            isUpdateAvailable: updateStore.isUpdateAvailable,
            isUpgrading: updateStore.isUpgrading,
            latestVersion: updateStore.latestVersion,
            onToggleRecording: toggleRecording,
            onSearch: { presentCommandPalette() },
            onOpenSettings: { openSettings() },
            onBack: { _ = history.goBack() },
            onForward: { _ = history.goForward() },
            onCheckForUpdates: {
                Task { await updateStore.checkNativeAppForUpdates() }
            },
            updateStore: updateStore
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
                integrations: configureStore.integrationSections,
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
                onOpenMemories: {
                    openWindow(id: "memories")
                },
                onNavigateToRoute: { route in
                    bringMainWindowToFront()
                    navigateToRoute(route)
                },
                onOpenIntegration: { navKey in
                    openSettings(navKey: navKey)
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

    private func startChatAboutRecording(_ request: StartChatAboutRecordingRequest) {
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

    private func showChatSession(_ sessionId: String) {
        bringMainWindowToFront()
        navigateToRoute(.chat)
        Task { await store.selectSession(id: sessionId) }
    }

    private var selectedRecordingHasAudio: Bool {
        recordingsStore.detail?.hasAudio ?? recordingsStore.selectedRecording?.hasAudio ?? false
    }

    private var selectedRecordingHasTranscript: Bool {
        recordingsStore.detail?.hasTranscript ?? recordingsStore.selectedRecording?.hasTranscript ?? false
    }

    private var selectedRecordingHasSummary: Bool {
        recordingsStore.detail?.showsSummary ?? recordingsStore.selectedRecording?.hasSummary ?? false
    }

    private var isSelectedRecordingTranscribing: Bool {
        guard let id = recordingsStore.selectedRecording?.id else { return false }
        if let state = recordingsStore.transcriptionProcessing, state.recordingId == id, state.isActive {
            return true
        }
        if let state = store.recordingProcessing, state.recordingId == id, state.isActive {
            return true
        }
        return false
    }

    private func startChatAboutSelectedRecording() {
        guard let recording = recordingsStore.selectedRecording else { return }
        let detail = recordingsStore.detail ?? .placeholder(from: recording)
        startChatAboutRecording(startChatAboutRecordingRequest(from: detail))
    }

    private func transcribeSelectedRecording() {
        guard let id = recordingsStore.selectedRecording?.id else { return }
        Task { await recordingsStore.transcribeRecording(id: id) }
    }

    private func summarizeSelectedRecording() {
        guard let id = recordingsStore.selectedRecording?.id else { return }
        recordingsStore.selectedDetailTab = .summary
        Task { await recordingsStore.summarizeRecording(id: id) }
    }

    private func showChatForSelectedRecording() {
        guard let sessionId = existingRecordingChatSessionId(
            chatSessionId: recordingsStore.detail?.metadata.chatSessionId,
            validSessionIds: Set(store.sessions.map(\.id))
        ) else { return }
        showChatSession(sessionId)
    }

    private func startNewChat() {
        if shouldCreateProjectChat(
            currentRoute: history.current,
            selectedProjectId: projectsStore.selectedProjectId,
        ) {
            Task { await projectsStore.createChat(chatStore: store) }
            return
        }
        startNewChat(persona: nil)
    }

    private func startNewChat(persona: PersonaOption?) {
        navigateToRoute(.chat)
        Task { await store.startNewSession(persona: persona) }
    }

    private func startNewSchedule() {
        bringMainWindowToFront()
        navigateToRoute(.schedules)
        schedulesStore.startCreate()
    }

    private func startNewSkill() {
        bringMainWindowToFront()
        navigateToRoute(.skills)
        skillsStore.startCreate()
    }

    private func startNewProject() {
        bringMainWindowToFront()
        navigateToRoute(.projects)
        projectsStore.startCreate()
    }

    private func startNewMemory() {
        memoriesStore.startCreate()
        openWindow(id: "memories")
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

    private func openRecentWork(_ item: DashboardRecentWorkItem) {
        switch item.kind {
        case let .chat(id):
            navigateToRoute(.chat)
            selectSession(id)
        case let .project(id):
            navigateToRoute(.projects)
            Task { await projectsStore.selectProject(id: id) }
        }
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
        leaveProjectSessionIfMainChatVisible()
    }

    private func showRouteOverviewIfNeeded(_ route: DetailRoute) {
        guard route == history.current else { return }

        switch route {
        case .projects:
            Task { await projectsStore.selectHome() }
        case .schedules:
            schedulesStore.selectHome()
        case .flows:
            flowsStore.selectHome()
        case .recordings:
            recordingsStore.showRecordingsOverview()
        case .skills:
            skillsStore.selectHome()
        case .chat:
            preferChatSessionList = true
        case .dashboard:
            break
        }
    }

    private func leaveProjectSessionIfMainChatVisible() {
        guard shouldLeaveProjectSessionForMainChat(
            currentRoute: history.current,
            sessionProjectId: store.sessionProjectId,
            isLoading: store.isLoading,
        ) else { return }
        store.leaveProjectSessionIfNeeded()
    }

    private func openDashboardFlow(_ flowId: String) {
        navigateToRoute(.flows)
        Task {
            await flowsStore.ensureLoaded()
            await flowsStore.selectFlow(id: flowId)
        }
    }

    private func runDashboardFlow(_ flowId: String) async -> FlowRunNowResponse? {
        await flowsStore.ensureLoaded()
        return await flowsStore.runFlow(id: flowId)
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
        async let integrations: () = loadIntegrationsCatalogIfNeeded()
        _ = await (sessions, schedules, recordings, memories, skills, projects, integrations)
    }

    /// Soft-reset feature stores after Settings → General switches the Toby home.
    private func handleTobyHomeDidChange() async {
        hasCompletedInitialLoad = false
        history.resetToDashboard()

        dashboardStore.resetForHomeSwitch()
        configureStore.resetForHomeSwitch()
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
        async let integrations: () = loadIntegrationsCatalogIfNeeded()
        _ = await (sessions, schedules, recordings, memories, skills, projects, integrations)
    }

    private func refreshDashboardData() async {
        // Force every registered block (bypasses server caches; awaits AI).
        // Shared app stores refresh in parallel but do not gate the spinner.
        async let dashboard: () = dashboardStore.refreshAll()
        async let shared: () = refreshSharedAppDataIfConnected()
        _ = await (dashboard, shared)
    }

    private func loadIntegrationsCatalogIfNeeded() async {
        guard configureStore.integrationSections.isEmpty else { return }
        await configureStore.loadSettingsSections(selectDefaultIfNeeded: false)
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

    private func applyDebugUpdateOverride() {
        let environment = ProcessInfo.processInfo.environment
        let latestVersion = environment["TOBY_DEBUG_LATEST_VERSION"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let latestVersion, !latestVersion.isEmpty else { return }

        let currentVersion = environment["TOBY_DEBUG_CURRENT_VERSION"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        updateStore.applyDebugOverride(
            latestVersion: latestVersion,
            currentVersion: currentVersion?.isEmpty == false ? currentVersion : nil
        )

        if let currentVersion, !currentVersion.isEmpty {
            let currentStatus = store.status
            store.status = AppStatus(
                version: UpdateStore.normalizedVersion(currentVersion),
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

}

func shouldCreateProjectChat(
    currentRoute: DetailRoute,
    selectedProjectId: String?
) -> Bool {
    currentRoute == .projects && selectedProjectId != nil
}

func shouldLeaveProjectSessionForMainChat(
    currentRoute: DetailRoute,
    sessionProjectId: String?,
    isLoading: Bool
) -> Bool {
    guard currentRoute == .chat, !isLoading else { return false }
    let projectId = sessionProjectId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return !projectId.isEmpty
}
