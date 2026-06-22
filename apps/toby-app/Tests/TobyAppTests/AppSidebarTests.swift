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
            isRecording: false,
            isRecordDisabled: false,
            onToggleRecording: {},
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
        // Buttons: changelog header + record + session×2 + integrations + schedules + recordings + settings + persona
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
            isRecording: false,
            isRecordDisabled: false,
            onToggleRecording: {},
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

}
