import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("AppSidebar")
struct AppSidebarTests {
    private func makeSidebar(sessions: [SessionSummary] = [], selectedId: String? = nil) -> AppSidebar {
        AppSidebar(
            sessions: sessions,
            selectedSessionId: selectedId,
            status: nil,
            daemonStatus: nil,
            isLoading: false,
            isSessionsLoading: false,
            onSelectSession: { _ in },
            onDeleteSession: { _ in },
            onOpenSettings: { _ in },
            onOpenRecordings: {},
            onOpenSchedules: {},
            onOpenIntegrations: {},
            onOpenSkills: {},
            onOpenPersonasSettings: {},
            onPersonaSelected: {},
            onOpenChangelog: {}
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

    @Test("session count matches provided data")
    func sessionCountMatchesData() throws {
        let sessions = [
            SessionSummary(id: "1", name: "First Session", createdAt: nil, updatedAt: nil),
            SessionSummary(id: "2", name: "Second Session", createdAt: nil, updatedAt: nil),
        ]
        let view = makeSidebar(sessions: sessions)
        // Sessions are rendered inside a ScrollView > VStack > ForEach
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        // Buttons: changelog header + session×2 + integrations + schedules + recordings + settings + persona
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
            sessions: [session],
            selectedSessionId: nil,
            status: nil,
            daemonStatus: nil,
            isLoading: false,
            isSessionsLoading: false,
            onSelectSession: { selectedId = $0 },
            onDeleteSession: { _ in },
            onOpenSettings: { _ in },
            onOpenRecordings: {},
            onOpenSchedules: {},
            onOpenIntegrations: {},
            onOpenSkills: {},
            onOpenPersonasSettings: {},
            onPersonaSelected: {},
            onOpenChangelog: {}
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

    @Test("scroll progress clamped to 0...1")
    func scrollProgressClamped() {
        #expect(clampedScrollProgress(contentHeight: 400, visibleHeight: 220, offset: 0) == 0)
        #expect(clampedScrollProgress(contentHeight: 400, visibleHeight: 220, offset: 90) == 0.5)
        #expect(clampedScrollProgress(contentHeight: 400, visibleHeight: 220, offset: 180) == 1)
        #expect(clampedScrollProgress(contentHeight: 400, visibleHeight: 220, offset: 999) == 1)
        #expect(clampedScrollProgress(contentHeight: 200, visibleHeight: 220, offset: 0) == 0)
    }

}
