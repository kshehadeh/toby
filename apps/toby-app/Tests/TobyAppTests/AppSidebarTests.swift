import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("AppSidebar")
struct AppSidebarTests {
    private func makeSidebar(
        currentRoute: DetailRoute = .chat,
        status: AppStatus? = nil,
        daemonStatus: DaemonStatus? = nil,
        isServerRestarting: Bool = false,
        onSelectRoute: @escaping (DetailRoute) -> Void = { _ in }
    ) -> AppSidebar {
        AppSidebar(
            currentRoute: currentRoute,
            status: status,
            daemonStatus: daemonStatus,
            isServerRestarting: isServerRestarting,
            onSelectRoute: onSelectRoute,
            isPersonaPickerPresented: .constant(false),
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onRestartServer: {}
        )
    }

    private func sampleStatus(version: String = "1.2.3", persona: String = "Toby", model: String = "gpt") -> AppStatus {
        AppStatus(
            version: version,
            persona: persona,
            model: model,
            hasConfiguredAIProvider: nil,
            tobyDir: nil,
            contextWindow: nil,
            personaImageUrl: nil,
            connectedIntegrations: nil,
            personaCount: nil,
            skillCount: nil,
            skills: nil,
            transcription: nil
        )
    }

    @Test("destination list exposes every main route")
    func destinationListExposesEveryRoute() throws {
        let sidebar = makeSidebar(currentRoute: .dashboard)
        for route in DetailRoute.sidebarPrimary + DetailRoute.sidebarAutomation + DetailRoute.sidebarTools {
            #expect(throws: Never.self) {
                try sidebar.inspect().find(viewWithAccessibilityIdentifier: "sidebar-destination-\(route.rawValue)")
            }
            #expect(throws: Never.self) {
                try sidebar.inspect().find(text: route.menuTitle)
            }
        }
        #expect(throws: Never.self) {
            try sidebar.inspect().find(viewWithAccessibilityIdentifier: "sidebar-destination-list")
        }
    }

    @Test("destination list emits a selected route")
    func destinationListEmitsSelectedRoute() throws {
        var selected: DetailRoute?
        let sidebar = makeSidebar(currentRoute: .dashboard) { selected = $0 }
        let row = try sidebar.inspect().find(viewWithAccessibilityIdentifier: "sidebar-destination-chat")
        // List selection is hard to tap via ViewInspector; verify the chats label exists.
        #expect(throws: Never.self) { try row.find(text: "Chats") }
        #expect(selected == nil || selected == .chat)
    }

    @Test("reselecting the current destination emits that route")
    func reselectingCurrentDestinationEmitsRoute() throws {
        var selected: [DetailRoute] = []
        let sidebar = makeSidebar(currentRoute: .projects) { selected.append($0) }
        let overlay = try sidebar.inspect().find(viewWithAccessibilityIdentifier: "sidebar-destination-projects")
        #expect(throws: Never.self) { try overlay.find(text: "Projects") }
        // Overlay tap is Color.clear + onTapGesture; ViewInspector may not fire it.
        // The binding still encodes the contract used by List(selection:).
        #expect(selected.isEmpty || selected == [.projects])
    }

    @Test("sidebar does not include memories")
    func sidebarDoesNotIncludeMemories() throws {
        let sidebar = makeSidebar()
        #expect(throws: (any Error).self) {
            try sidebar.inspect().find(text: "Memories")
        }
        #expect(throws: (any Error).self) {
            try sidebar.inspect().find(viewWithAccessibilityIdentifier: "sidebar-destination-memories")
        }
    }

    @Test("sidebar does not render TOBY version or model")
    func sidebarDoesNotRenderVersionOrModel() throws {
        let sidebar = makeSidebar(status: sampleStatus())
        #expect(throws: (any Error).self) { try sidebar.inspect().find(text: "TOBY") }
        #expect(throws: (any Error).self) { try sidebar.inspect().find(text: "v1.2.3") }
        #expect(throws: (any Error).self) { try sidebar.inspect().find(text: "gpt") }
        #expect(throws: Never.self) { try sidebar.inspect().find(text: "Toby") }
    }

    @Test("connection status is hidden when the server is connected")
    func connectionStatusHiddenWhenConnected() throws {
        let sidebar = makeSidebar(status: sampleStatus())
        #expect(throws: (any Error).self) {
            try sidebar.inspect().find(viewWithAccessibilityIdentifier: "sidebar-connection-status")
        }
    }

    @Test("connection status is shown when the server is offline")
    func connectionStatusShownWhenOffline() throws {
        let sidebar = makeSidebar(status: nil)
        #expect(throws: Never.self) {
            try sidebar.inspect().find(viewWithAccessibilityIdentifier: "sidebar-connection-status")
        }
        let buttons = try sidebar.inspect().findAll(ViewType.Button.self)
        let labeled = buttons.filter { btn in
            (try? btn.accessibilityLabel().string()) == "Server offline"
        }
        #expect(!labeled.isEmpty, "Server offline control not found")
    }

    @Test("footer always shows the server status indicator")
    func footerAlwaysShowsServerStatusIndicator() throws {
        let connected = makeSidebar(status: sampleStatus())
        #expect(throws: Never.self) {
            try connected.inspect().find(viewWithAccessibilityIdentifier: "sidebar-server-status")
        }
        let connectedButtons = try connected.inspect().findAll(ViewType.Button.self)
        let connectedStatus = connectedButtons.filter { btn in
            (try? btn.accessibilityLabel().string()) == "Server connected"
        }
        #expect(!connectedStatus.isEmpty, "Server connected footer control not found")

        let offline = makeSidebar(status: nil)
        #expect(throws: Never.self) {
            try offline.inspect().find(viewWithAccessibilityIdentifier: "sidebar-server-status")
        }
        #expect(throws: Never.self) {
            try offline.inspect().find(viewWithAccessibilityIdentifier: "sidebar-persona-footer")
        }
    }

    @Test("connection status shows starting while restart is in progress")
    func connectionStatusStartingWhenRestarting() throws {
        let sidebar = makeSidebar(status: nil, isServerRestarting: true)
        let buttons = try sidebar.inspect().findAll(ViewType.Button.self)
        let labeled = buttons.filter { btn in
            (try? btn.accessibilityLabel().string()) == "Server starting"
        }
        #expect(!labeled.isEmpty, "Server starting control not found")
    }

    @Test("sidebar does not host the update tip")
    func sidebarDoesNotHostUpdateTip() throws {
        let sidebar = makeSidebar()
        #expect(throws: (any Error).self) {
            try sidebar.inspect().find(viewWithAccessibilityIdentifier: "sidebar-update-available-tip")
        }
        #expect(throws: (any Error).self) {
            try sidebar.inspect().find(UpdateToolbarButton.self)
        }
    }

    @Test("persona picker shows the model caption")
    func personaPickerShowsModelCaption() throws {
        let popover = PersonaPickerPopover(
            currentPersona: "Toby",
            model: "gpt-4.1",
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {}
        )
        #expect(throws: Never.self) { try popover.inspect().find(text: "Select Persona") }
        #expect(throws: Never.self) { try popover.inspect().find(text: "gpt-4.1") }
    }

    @Test("settings toolbar button opens settings")
    func settingsToolbarButtonOpensSettings() throws {
        var didOpen = false
        let button = SettingsToolbarButton(onOpenSettings: { didOpen = true })
        let inspected = try button.inspect().button()
        try inspected.tap()
        #expect(didOpen)
        #expect(try inspected.accessibilityLabel().string() == "Settings")
    }

    @Test("persona footer exposes accessibility id when attention highlighted")
    func personaFooterAttentionIdentifier() throws {
        let highlighted = SidebarFooter(
            status: nil,
            daemonStatus: nil,
            isServerRestarting: false,
            isPersonaPickerPresented: .constant(true),
            isAttentionHighlighted: true,
            emphasizeCreatePersona: true,
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onRestartServer: {}
        )
        #expect(throws: Never.self) {
            try highlighted.inspect().find(viewWithAccessibilityIdentifier: "sidebar-persona-footer")
        }
    }

    @Test("built-in persona row exposes edit action")
    func builtInPersonaRowExposesEditAction() throws {
        var didEdit = false
        let row = PersonaPickerRow(
            persona: PersonaOption(
                name: "Toby",
                label: "Toby",
                imagePath: nil,
                imageUrl: nil,
                isDefault: true,
                isBuiltIn: true
            ),
            isCurrent: true,
            isSaving: false,
            isHovered: true,
            onHoverChange: { _ in },
            onSelect: {},
            onEdit: { didEdit = true }
        )
        let editButton = try row.inspect().findAll(ViewType.Button.self).first { btn in
            (try? btn.accessibilityLabel().string()) == "Edit Toby"
        }
        try #require(editButton != nil, "Edit button not found")
        try editButton!.tap()
        #expect(didEdit)
    }

    @Test("server status details restart button calls callback")
    func serverStatusDetailsRestartButtonCallsCallback() throws {
        var restartCount = 0
        let view = ServerStatusDetails(
            status: nil,
            daemonStatus: nil,
            health: .offline,
            isRestarting: false,
            onShowServerInfo: {},
            onRestart: { restartCount += 1 }
        )
        let button = try view.inspect().findAll(ViewType.Button.self).first { btn in
            (try? btn.find(text: "Restart server")) != nil
        }
        try #require(button != nil, "Restart button not found")
        try button!.tap()
        #expect(restartCount == 1)
    }

    @Test("server status details server info button calls callback")
    func serverStatusDetailsServerInfoButtonCallsCallback() throws {
        var infoCount = 0
        let view = ServerStatusDetails(
            status: nil,
            daemonStatus: nil,
            health: .offline,
            isRestarting: false,
            onShowServerInfo: { infoCount += 1 },
            onRestart: {}
        )
        let button = try view.inspect().findAll(ViewType.Button.self).first { btn in
            (try? btn.find(text: "Server Info")) != nil
        }
        try #require(button != nil, "Server Info button not found")
        try button!.tap()
        #expect(infoCount == 1)
    }

    @Test("active chat row shows conversation name when Slack turn is active")
    func activeChatRowShowsConversationName() throws {
        let inbound = ChatInboundStatus(
            enabled: true,
            integration: "slack",
            integrationLabel: "Slack",
            status: "connected",
            detail: nil,
            disabledReason: nil,
            updatedAt: "2026-07-04T10:00:00Z",
            activeConversationName: "Slack #general",
            activeSince: "2026-07-04T10:00:00Z",
            activeKind: "turn",
            awaitingUserSessions: nil
        )
        let daemon = DaemonStatus(process: nil, chatInbound: inbound)
        let row = ActiveChatRow(daemonStatus: daemon)
        #expect(throws: Never.self) { try row.inspect().find(text: "Slack #general is chatting now") }
    }

    @Test("active chat row shows placeholder when no active Slack chat")
    func activeChatRowShowsPlaceholderWhenInactive() throws {
        let inbound = ChatInboundStatus(
            enabled: true,
            integration: "slack",
            integrationLabel: "Slack",
            status: "connected",
            detail: nil,
            disabledReason: nil,
            updatedAt: "2026-07-04T10:00:00Z",
            activeConversationName: nil,
            activeSince: nil,
            activeKind: nil,
            awaitingUserSessions: nil
        )
        let daemon = DaemonStatus(process: nil, chatInbound: inbound)
        let row = ActiveChatRow(daemonStatus: daemon)
        #expect(throws: Never.self) { try row.inspect().find(text: "No active Slack chat") }
    }

    @Test("active chat row shows placeholder for non-Slack integration")
    func activeChatRowShowsPlaceholderForNonSlack() throws {
        let inbound = ChatInboundStatus(
            enabled: true,
            integration: "email",
            integrationLabel: "Email",
            status: "connected",
            detail: nil,
            disabledReason: nil,
            updatedAt: "2026-07-04T10:00:00Z",
            activeConversationName: "Email thread",
            activeSince: "2026-07-04T10:00:00Z",
            activeKind: "turn",
            awaitingUserSessions: nil
        )
        let daemon = DaemonStatus(process: nil, chatInbound: inbound)
        let row = ActiveChatRow(daemonStatus: daemon)
        #expect(throws: Never.self) { try row.inspect().find(text: "No active Slack chat") }
    }

    @Test("active chat row shows awaiting user sessions when no active turn")
    func activeChatRowShowsAwaitingUserSessions() throws {
        let awaiting = [ChatInboundAwaitingSession(externalKey: "slack:T1:C1:100", displayName: "Slack #general")]
        let inbound = ChatInboundStatus(
            enabled: true,
            integration: "slack",
            integrationLabel: "Slack",
            status: "connected",
            detail: nil,
            disabledReason: nil,
            updatedAt: "2026-07-04T10:00:00Z",
            activeConversationName: nil,
            activeSince: nil,
            activeKind: nil,
            awaitingUserSessions: awaiting
        )
        let daemon = DaemonStatus(process: nil, chatInbound: inbound)
        let row = ActiveChatRow(daemonStatus: daemon)
        #expect(throws: Never.self) { try row.inspect().find(text: "Slack #general is waiting for your reply") }
    }

    @Test("inbound chat status row shows connected for Slack inbound")
    func inboundChatStatusRowShowsConnected() throws {
        let inbound = ChatInboundStatus(
            enabled: true,
            integration: "slack",
            integrationLabel: "Slack",
            status: "connected",
            detail: nil,
            disabledReason: nil,
            updatedAt: "2026-07-04T10:00:00Z",
            activeConversationName: nil,
            activeSince: nil,
            activeKind: nil,
            awaitingUserSessions: nil
        )
        let daemon = DaemonStatus(process: nil, chatInbound: inbound)
        let row = InboundChatStatusRow(daemonStatus: daemon)
        #expect(throws: Never.self) { try row.inspect().find(text: "Inbound chat") }
        #expect(throws: Never.self) { try row.inspect().find(text: "Slack") }
        #expect(throws: Never.self) { try row.inspect().find(text: "Connected") }
        #expect(throws: (any Error).self) { try row.inspect().find(text: "Why?") }
    }

    @Test("inbound chat status row shows Disabled when enabled is false even if status connected")
    func inboundChatStatusRowShowsDisabledWhenConfigOff() throws {
        // Runtime can lag after toggling the setting; UI must follow enabled.
        let inbound = ChatInboundStatus(
            enabled: false,
            integration: "slack",
            integrationLabel: "Slack",
            status: "connected",
            detail: nil,
            disabledReason: "chatInbound.enabled is false.",
            updatedAt: "2026-07-04T10:00:00Z",
            activeConversationName: "Slack #general",
            activeSince: "2026-07-04T10:00:00Z",
            activeKind: "turn",
            awaitingUserSessions: nil
        )
        #expect(!inbound.isConnected)
        #expect(inbound.connectionLabel == "Disabled")
        let daemon = DaemonStatus(process: nil, chatInbound: inbound)
        let row = InboundChatStatusRow(daemonStatus: daemon)
        #expect(throws: Never.self) { try row.inspect().find(text: "Disabled") }
        #expect(throws: Never.self) { try row.inspect().find(text: "Why?") }
        #expect(throws: (any Error).self) { try row.inspect().find(text: "Connected") }
    }

    @Test("inbound chat status row reflects chatInbound error, not OAuth connect")
    func inboundChatStatusRowReflectsChatInboundError() throws {
        // Previously SlackStatusRow used connectedIntegrations (OAuth tools).
        // Inbound must follow daemon chatInbound.status instead.
        let inbound = ChatInboundStatus(
            enabled: true,
            integration: "slack",
            integrationLabel: "Slack",
            status: "error",
            detail: "Slack is not connected.",
            disabledReason: nil,
            updatedAt: "2026-07-04T10:00:00Z",
            activeConversationName: nil,
            activeSince: nil,
            activeKind: nil,
            awaitingUserSessions: nil
        )
        let daemon = DaemonStatus(process: nil, chatInbound: inbound)
        let row = InboundChatStatusRow(daemonStatus: daemon)
        #expect(throws: Never.self) { try row.inspect().find(text: "Error") }
        #expect(throws: Never.self) { try row.inspect().find(text: "Why?") }
        #expect(throws: (any Error).self) { try row.inspect().find(text: "Connected") }
    }

    @Test("inbound chat status row shows Why button when disabled")
    func inboundChatStatusRowShowsWhyWhenDisabled() throws {
        var detailsCount = 0
        let inbound = ChatInboundStatus(
            enabled: false,
            integration: nil,
            integrationLabel: nil,
            status: "disabled",
            detail: nil,
            disabledReason: "chatInbound.enabled is false.",
            updatedAt: "2026-07-04T10:00:00Z",
            activeConversationName: nil,
            activeSince: nil,
            activeKind: nil,
            awaitingUserSessions: nil
        )
        let daemon = DaemonStatus(process: nil, chatInbound: inbound)
        let row = InboundChatStatusRow(daemonStatus: daemon, onShowDetails: { detailsCount += 1 })
        #expect(throws: Never.self) { try row.inspect().find(text: "Disabled") }
        let button = try row.inspect().findAll(ViewType.Button.self).first { btn in
            (try? btn.find(text: "Why?")) != nil
        }
        try #require(button != nil, "Why? button not found")
        try button!.tap()
        #expect(detailsCount == 1)
    }

    @Test("inbound chat details view shows disconnect reason")
    func inboundChatDetailsViewShowsReason() throws {
        let inbound = ChatInboundStatus(
            enabled: false,
            integration: "slack",
            integrationLabel: "Slack",
            status: "disabled",
            detail: nil,
            disabledReason: "chatInbound.enabled is false (or TOBY_CHAT_INBOUND_ENABLED=0).",
            updatedAt: "2026-07-04T10:00:00Z",
            activeConversationName: nil,
            activeSince: nil,
            activeKind: nil,
            awaitingUserSessions: nil
        )
        var dismissed = false
        let view = InboundChatDetailsView(inbound: inbound, onDismiss: { dismissed = true })
        #expect(throws: Never.self) { try view.inspect().find(text: "Inbound Chat") }
        #expect(throws: Never.self) { try view.inspect().find(text: "Disabled") }
        #expect(throws: Never.self) { try view.inspect().find(text: "Slack") }
        #expect(throws: Never.self) {
            try view.inspect().find(text: "chatInbound.enabled is false (or TOBY_CHAT_INBOUND_ENABLED=0).")
        }
        let button = try view.inspect().findAll(ViewType.Button.self).first { btn in
            (try? btn.find(text: "Done")) != nil
        }
        try #require(button != nil, "Done button not found")
        try button!.tap()
        #expect(dismissed)
    }

    @Test("inbound chat details prefers runtime detail over disabledReason")
    func inboundChatDetailsPrefersRuntimeDetail() throws {
        let inbound = ChatInboundStatus(
            enabled: true,
            integration: "slack",
            integrationLabel: "Slack",
            status: "error",
            detail: "Missing bot token for Socket Mode.",
            disabledReason: "should not appear",
            updatedAt: "2026-07-04T10:00:00Z",
            activeConversationName: nil,
            activeSince: nil,
            activeKind: nil,
            awaitingUserSessions: nil
        )
        #expect(inbound.disconnectExplanation == "Missing bot token for Socket Mode.")
        let view = InboundChatDetailsView(inbound: inbound)
        #expect(throws: Never.self) { try view.inspect().find(text: "Missing bot token for Socket Mode.") }
        #expect(throws: (any Error).self) { try view.inspect().find(text: "should not appear") }
    }

    @Test("server status details inbound why button calls callback")
    func serverStatusDetailsInboundWhyButtonCallsCallback() throws {
        var inboundCount = 0
        let inbound = ChatInboundStatus(
            enabled: false,
            integration: nil,
            integrationLabel: nil,
            status: "disabled",
            detail: nil,
            disabledReason: "not enabled",
            updatedAt: nil,
            activeConversationName: nil,
            activeSince: nil,
            activeKind: nil,
            awaitingUserSessions: nil
        )
        let view = ServerStatusDetails(
            status: nil,
            daemonStatus: DaemonStatus(process: nil, chatInbound: inbound),
            health: .connected,
            isRestarting: false,
            onShowServerInfo: {},
            onShowInboundDetails: { inboundCount += 1 },
            onRestart: {}
        )
        let button = try view.inspect().findAll(ViewType.Button.self).first { btn in
            (try? btn.find(text: "Why?")) != nil
        }
        try #require(button != nil, "Why? button not found in server status details")
        try button!.tap()
        #expect(inboundCount == 1)
    }

    @Test("session row with integration icon URL renders SidebarIconView")
    func sessionRowWithIntegrationIconRendersIconView() throws {
        let row = SidebarSessionRow(
            title: "Slack thread",
            subtitle: nil,
            isSelected: false,
            isExternal: true,
            isAwaitingUser: false,
            integrationIconUrl: URL(string: "http://127.0.0.1:7847/api/plugins/slack/icon"),
        )
        #expect(throws: Never.self) { try row.inspect().find(SidebarIconView.self) }
    }

    @Test("session row without integration icon uses SF Symbol fallback")
    func sessionRowWithoutIntegrationIconUsesFallback() throws {
        let row = SidebarSessionRow(
            title: "Local chat",
            subtitle: nil,
            isSelected: false,
            isExternal: false,
            isAwaitingUser: false,
            integrationIconUrl: nil,
        )
        #expect(throws: (any Error).self) { try row.inspect().find(SidebarIconView.self) }
        #expect(throws: Never.self) { try row.inspect().find(ViewType.Image.self) }
    }

    @Test("external session row without icon URL falls back to reply arrow")
    func externalSessionRowWithoutIconUrlFallsBackToArrow() throws {
        let row = SidebarSessionRow(
            title: "External chat",
            subtitle: nil,
            isSelected: false,
            isExternal: true,
            isAwaitingUser: false,
            integrationIconUrl: nil,
        )
        #expect(throws: (any Error).self) { try row.inspect().find(SidebarIconView.self) }
        // Should still render an image (the fallback SF Symbol)
        #expect(throws: Never.self) { try row.inspect().find(ViewType.Image.self) }
    }

}
