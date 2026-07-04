import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("AppSidebar")
struct AppSidebarTests {
    private func makeSidebar(sessions: [SessionSummary] = [], selectedId: String? = nil, currentRoute: DetailRoute = .chat) -> AppSidebar<ChatSessionsSidebar> {
        AppSidebar(
            currentRoute: currentRoute,
            status: nil,
            daemonStatus: nil,
            isServerRestarting: false,
            updateStore: nil,
            onSelectRoute: { _ in },
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onCheckForUpdates: {},
            onRestartServer: {},
            sidebarContent: {
                ChatSessionsSidebar(
                    sessions: sessions,
                    selectedSessionId: selectedId,
                    isLoading: false,
                    isSessionsLoading: false,
                    onSelectSession: { _ in },
                    onDeleteSession: { _ in }
                )
            }
        )
    }

    private func makeSidebarWithRoute(currentRoute: DetailRoute, onSelectRoute: @escaping (DetailRoute) -> Void) -> AppSidebar<EmptyView> {
        AppSidebar(
            currentRoute: currentRoute,
            status: nil,
            daemonStatus: nil,
            isServerRestarting: false,
            updateStore: nil,
            onSelectRoute: onSelectRoute,
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onCheckForUpdates: {},
            onRestartServer: {},
            sidebarContent: { EmptyView() }
        )
    }

    @Test("renders Chats section header")
    func rendersChatsHeader() throws {
        let view = makeSidebar(sessions: [])
        #expect(throws: Never.self) { try view.inspect().find(text: "Chats") }
    }

    @Test("empty sessions shows placeholder text")
    func emptySessionsShowsPlaceholder() throws {
        let view = makeSidebar(sessions: [])
        #expect(throws: Never.self) { try view.inspect().find(text: "No past sessions") }
    }

    @Test("loading sessions shows loading text")
    func loadingSessionsShowsLoadingText() throws {
        let sidebar = AppSidebar(
            currentRoute: .chat,
            status: nil,
            daemonStatus: nil,
            isServerRestarting: false,
            updateStore: nil,
            onSelectRoute: { _ in },
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onCheckForUpdates: {},
            onRestartServer: {},
            sidebarContent: {
                ChatSessionsSidebar(
                    sessions: [],
                    selectedSessionId: nil,
                    isLoading: false,
                    isSessionsLoading: true,
                    onSelectSession: { _ in },
                    onDeleteSession: { _ in }
                )
            }
        )
        #expect(throws: Never.self) { try sidebar.inspect().find(text: "Loading sessions…") }
    }

    @Test("session count matches provided data")
    func sessionCountMatchesData() throws {
        let sessions = [
            SessionSummary(id: "1", name: "First Session", createdAt: nil, updatedAt: nil),
            SessionSummary(id: "2", name: "Second Session", createdAt: nil, updatedAt: nil),
        ]
        let view = makeSidebar(sessions: sessions)
        // Sessions are rendered inside a ScrollView > VStack > ForEach
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        // Buttons: app header + session×2 + chats + integrations + skills + schedules + recordings + settings + persona
        let sessionButtons = buttons.filter { btn in
            guard let label = try? btn.labelView().find(ViewType.Text.self),
                  let text = try? label.string() else { return false }
            return sessions.map(\.name).contains(text)
        }
        #expect(sessionButtons.count == 2)
    }

    @Test("tapping session button calls onSelectSession")
    func selectSessionCallback() throws {
        var selectedId: String?
        let session = SessionSummary(id: "abc", name: "My Session", createdAt: nil, updatedAt: nil)
        let sidebar = AppSidebar(
            currentRoute: .chat,
            status: nil,
            daemonStatus: nil,
            isServerRestarting: false,
            updateStore: nil,
            onSelectRoute: { _ in },
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onCheckForUpdates: {},
            onRestartServer: {},
            sidebarContent: {
                ChatSessionsSidebar(
                    sessions: [session],
                    selectedSessionId: nil,
                    isLoading: false,
                    isSessionsLoading: false,
                    onSelectSession: { selectedId = $0 },
                    onDeleteSession: { _ in }
                )
            }
        )
        // Find the button whose label text matches the session name
        let buttons = try sidebar.inspect().findAll(ViewType.Button.self)
        let sessionButton = try buttons.first { btn in
            (try? btn.find(text: "My Session")) != nil
        }
        try #require(sessionButton != nil, "Session button not found")
        try sessionButton!.tap()
        #expect(selectedId == "abc")
    }

    @Test("Toby section buttons emit correct routes")
    func tobySectionButtonsEmitRoutes() throws {
        var selectedRoutes: [DetailRoute] = []
        let sidebar = makeSidebarWithRoute(currentRoute: .chat) { selectedRoutes.append($0) }
        let buttons = try sidebar.inspect().findAll(ViewType.Button.self)
        // The lower sidebar route buttons are icon-only and expose labels for accessibility.
        let integrationsButton = buttons.first { (try? $0.accessibilityLabel().string()) == "Integrations" }
        try #require(integrationsButton != nil, "Integrations button not found")
        try integrationsButton!.tap()
        let schedulesButton = buttons.first { (try? $0.accessibilityLabel().string()) == "Schedules" }
        try #require(schedulesButton != nil, "Schedules button not found")
        try schedulesButton!.tap()
        #expect(selectedRoutes == [.integrations, .schedules])
    }

    @Test("Chats button emits chat route")
    func chatsButtonEmitsChatRoute() throws {
        var selectedRoute: DetailRoute?
        let sidebar = makeSidebarWithRoute(currentRoute: .integrations) { selectedRoute = $0 }
        let buttons = try sidebar.inspect().findAll(ViewType.Button.self)
        let chatsButton = buttons.first { (try? $0.accessibilityLabel().string()) == "Chats" }
        try #require(chatsButton != nil, "Chats button not found")
        try chatsButton!.tap()
        #expect(selectedRoute == .chat)
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

    @Test("scroll progress clamped to 0...1")
    func scrollProgressClamped() {
        #expect(clampedScrollProgress(contentHeight: 400, visibleHeight: 220, offset: 0) == 0)
        #expect(clampedScrollProgress(contentHeight: 400, visibleHeight: 220, offset: 90) == 0.5)
        #expect(clampedScrollProgress(contentHeight: 400, visibleHeight: 220, offset: 180) == 1)
        #expect(clampedScrollProgress(contentHeight: 400, visibleHeight: 220, offset: 999) == 1)
        #expect(clampedScrollProgress(contentHeight: 200, visibleHeight: 220, offset: 0) == 0)
    }

    @Test("session with createdAt shows formatted date subtitle")
    func sessionShowsDateSubtitle() throws {
        let sessions = [
            SessionSummary(id: "1", name: "Dated Session", createdAt: "2026-06-22T10:00:00Z", updatedAt: nil),
        ]
        let view = makeSidebar(sessions: sessions)
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        let sessionButton = try buttons.first { btn in
            (try? btn.find(text: "Dated Session")) != nil
        }
        try #require(sessionButton != nil, "Session button not found")
        // The subtitle should contain "Jun" and "2026" from the medium date style
        let texts = try sessionButton!.findAll(ViewType.Text.self)
        let subtitleTexts = texts.compactMap { try? $0.string() }.filter { $0.contains("Jun") }
        #expect(subtitleTexts.count == 1)
        #expect(subtitleTexts[0].contains("2026"))
    }

    @Test("session with nil dates shows no subtitle text")
    func sessionWithNilDatesNoSubtitle() throws {
        let sessions = [
            SessionSummary(id: "1", name: "No Date Session", createdAt: nil, updatedAt: nil),
        ]
        let view = makeSidebar(sessions: sessions)
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        let sessionButton = try buttons.first { btn in
            (try? btn.find(text: "No Date Session")) != nil
        }
        try #require(sessionButton != nil, "Session button not found")
        // Only the title text should be present (no date subtitle)
        let texts = try sessionButton!.findAll(ViewType.Text.self)
        #expect(texts.count == 1)
    }

    @Test("header renders TOBY and version inline")
    func headerRendersTobyAndVersion() throws {
        let status = AppStatus(
            version: "1.2.3",
            persona: "default",
            model: "gpt",
            tobyDir: nil,
            contextWindow: nil,
            personaImageUrl: nil,
            connectedIntegrations: nil,
            skillCount: nil,
            skills: nil,
            transcription: nil
        )
        let sidebar = AppSidebar(
            currentRoute: .chat,
            status: status,
            daemonStatus: nil,
            isServerRestarting: false,
            updateStore: nil,
            onSelectRoute: { _ in },
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onCheckForUpdates: {},
            onRestartServer: {},
            sidebarContent: { EmptyView() }
        )
        let view = try sidebar.inspect()
        #expect(throws: Never.self) { try view.find(text: "TOBY") }
        #expect(throws: Never.self) { try view.find(text: "v1.2.3") }
    }

    @Test("header renders available update instead of current version")
    func headerRendersAvailableUpdateInsteadOfCurrentVersion() throws {
        let status = AppStatus(
            version: "1.2.3",
            persona: "default",
            model: "gpt",
            tobyDir: nil,
            contextWindow: nil,
            personaImageUrl: nil,
            connectedIntegrations: nil,
            skillCount: nil,
            skills: nil,
            transcription: nil
        )
        let updateStore = UpdateStore()
        updateStore.latestVersion = "1.2.4"
        updateStore.isUpdateAvailable = true
        let sidebar = AppSidebar(
            currentRoute: .chat,
            status: status,
            daemonStatus: nil,
            isServerRestarting: false,
            updateStore: updateStore,
            onSelectRoute: { _ in },
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onCheckForUpdates: {},
            onRestartServer: {},
            sidebarContent: { EmptyView() }
        )
        let view = try sidebar.inspect()
        #expect(throws: Never.self) { try view.find(text: "v1.2.4 is available now") }
        #expect(throws: (any Error).self) { try view.find(text: "v1.2.3") }
    }

    @Test("header button checks for updates")
    func headerButtonChecksForUpdates() throws {
        var checkCount = 0
        let sidebar = AppSidebar(
            currentRoute: .chat,
            status: nil,
            daemonStatus: nil,
            isServerRestarting: false,
            updateStore: nil,
            onSelectRoute: { _ in },
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onCheckForUpdates: { checkCount += 1 },
            onRestartServer: {},
            sidebarContent: { EmptyView() }
        )
        let buttons = try sidebar.inspect().findAll(ViewType.Button.self)
        let headerButton = buttons.first { btn in
            (try? btn.find(text: "TOBY")) != nil
        }
        try #require(headerButton != nil, "Header button not found")
        try headerButton!.tap()
        #expect(checkCount == 1)
    }

    @Test("server status button shows offline when status is nil")
    func serverStatusButtonOfflineWhenNil() throws {
        let sidebar = makeSidebarWithRoute(currentRoute: .chat) { _ in }
        let buttons = try sidebar.inspect().findAll(ViewType.Button.self)
        let serverButton = buttons.first { btn in
            (try? btn.find(text: "Server offline")) != nil
        }
        // The server status button uses an accessibilityLabel, not visible text.
        let labeled = buttons.filter { btn in
            (try? btn.accessibilityLabel().string()) == "Server offline"
        }
        #expect(!labeled.isEmpty, "Server offline button not found")
    }

    @Test("server status button shows connected when status present")
    func serverStatusButtonConnectedWhenPresent() throws {
        let status = AppStatus(
            version: "1.0.0",
            persona: "default",
            model: "gpt",
            tobyDir: nil,
            contextWindow: nil,
            personaImageUrl: nil,
            connectedIntegrations: nil,
            skillCount: nil,
            skills: nil,
            transcription: nil
        )
        let sidebar = AppSidebar(
            currentRoute: .chat,
            status: status,
            daemonStatus: nil,
            isServerRestarting: false,
            updateStore: nil,
            onSelectRoute: { _ in },
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onCheckForUpdates: {},
            onRestartServer: {},
            sidebarContent: { EmptyView() }
        )
        let buttons = try sidebar.inspect().findAll(ViewType.Button.self)
        let labeled = buttons.filter { btn in
            (try? btn.accessibilityLabel().string()) == "Server connected"
        }
        #expect(!labeled.isEmpty, "Server connected button not found")
    }

    @Test("server status button shows starting when daemon running but no status")
    func serverStatusButtonStartingWhenDaemonOnly() throws {
        let daemon = DaemonStatus(
            process: DaemonProcessInfo(
                pid: 1, uptimeSeconds: 5, startedAt: nil,
                intervalSeconds: nil, logPath: nil, webPort: nil,
                executablePath: nil
            ),
            chatInbound: nil
        )
        let sidebar = AppSidebar(
            currentRoute: .chat,
            status: nil,
            daemonStatus: daemon,
            isServerRestarting: false,
            updateStore: nil,
            onSelectRoute: { _ in },
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onCheckForUpdates: {},
            onRestartServer: {},
            sidebarContent: { EmptyView() }
        )
        let buttons = try sidebar.inspect().findAll(ViewType.Button.self)
        let labeled = buttons.filter { btn in
            (try? btn.accessibilityLabel().string()) == "Server starting"
        }
        #expect(!labeled.isEmpty, "Server starting button not found")
    }

    @Test("server status button shows starting while restart is in progress")
    func serverStatusButtonStartingWhenRestarting() throws {
        let sidebar = AppSidebar(
            currentRoute: .chat,
            status: nil,
            daemonStatus: nil,
            isServerRestarting: true,
            updateStore: nil,
            onSelectRoute: { _ in },
            onCreatePersona: {},
            onEditPersona: { _ in },
            onPersonaSelected: {},
            onCheckForUpdates: {},
            onRestartServer: {},
            sidebarContent: { EmptyView() }
        )
        let buttons = try sidebar.inspect().findAll(ViewType.Button.self)
        let labeled = buttons.filter { btn in
            (try? btn.accessibilityLabel().string()) == "Server starting"
        }
        #expect(!labeled.isEmpty, "Server starting button not found")
    }

    @Test("server status details restart button calls callback")
    func serverStatusDetailsRestartButtonCallsCallback() throws {
        var restartCount = 0
        let view = ServerStatusDetails(
            status: nil,
            daemonStatus: nil,
            health: .offline,
            isRestarting: false,
            onRestart: { restartCount += 1 }
        )
        let button = try view.inspect().findAll(ViewType.Button.self).first { btn in
            (try? btn.find(text: "Restart server")) != nil
        }
        try #require(button != nil, "Restart button not found")
        try button!.tap()
        #expect(restartCount == 1)
    }

}
