import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("CommandPaletteView")
struct CommandPaletteViewTests {
    private func makeView(
        sessions: [SessionSummary] = [],
        integrations: [SettingsItem] = [],
        schedules: [ScheduleViewModel] = [],
        recordings: [ListenRecordingSummary] = [],
        onSelectSession: @escaping (String) -> Void = { _ in },
        onNewChat: @escaping () -> Void = {},
        onOpenSettings: @escaping () -> Void = {},
        onNavigateToRoute: @escaping (DetailRoute) -> Void = { _ in },
        onOpenIntegration: @escaping (String) -> Void = { _ in },
        onOpenSchedule: @escaping (String) -> Void = { _ in },
        onOpenRecording: @escaping (String) -> Void = { _ in },
        onRestartServer: @escaping () -> Void = {},
        onDismiss: @escaping () -> Void = {}
    ) -> CommandPaletteView {
        CommandPaletteView(
            sessions: sessions,
            integrations: integrations,
            schedules: schedules,
            recordings: recordings,
            onSelectSession: onSelectSession,
            onNewChat: onNewChat,
            onOpenSettings: onOpenSettings,
            onNavigateToRoute: onNavigateToRoute,
            onOpenIntegration: onOpenIntegration,
            onOpenSchedule: onOpenSchedule,
            onOpenRecording: onOpenRecording,
            onRestartServer: onRestartServer,
            onDismiss: onDismiss
        )
    }

    private func makeIntegration(label: String, key: String, navKey: String? = nil) -> SettingsItem {
        SettingsItem(
            label: label,
            kind: .section,
            key: key,
            navKey: navKey ?? key,
            children: [],
            masked: nil,
            multiline: nil,
            options: nil,
            selectChoices: nil,
            currentValue: nil,
            selectedValues: nil,
            readOnly: nil
        )
    }

    private func makeSchedule(id: String, name: String, prompt: String = "", personaName: String = "") -> ScheduleViewModel {
        ScheduleViewModel(
            id: id,
            name: name,
            prompt: prompt,
            personaName: personaName,
            cronExpression: "0 9 * * *",
            cronHumanReadable: "Daily at 9:00 AM",
            nextRunAt: nil,
            enabled: true,
            lastRunAt: nil,
            recentRuns: []
        )
    }

    private func makeRecording(id: String, name: String? = nil, durationMs: Int? = nil, hasTranscript: Bool = false) -> ListenRecordingSummary {
        ListenRecordingSummary(
            id: id,
            dir: "/tmp",
            name: name,
            description: nil,
            createdAt: "2026-06-21T00:00:00Z",
            startedAt: "2026-06-21T00:00:00Z",
            stoppedAt: nil,
            durationMs: durationMs,
            sources: ListenSourceSelection(mic: true, system: false),
            hasAudio: true,
            hasTranscript: hasTranscript,
            hasSummary: false
        )
    }

    @Test("empty query shows actions, sessions, integrations, schedules, and recordings")
    func emptyQueryShowsAllResultTypes() throws {
        let view = makeView(
            sessions: [SessionSummary(id: "s1", name: "Session One", createdAt: nil, updatedAt: nil)],
            integrations: [makeIntegration(label: "Gmail", key: "gmail")],
            schedules: [makeSchedule(id: "sch1", name: "Daily Review")],
            recordings: [makeRecording(id: "rec1", name: "Team Meeting")]
        )
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        let titles = buttons.compactMap { try? $0.find(ViewType.Text.self).string() }
        #expect(titles.contains("New chat"))
        #expect(titles.contains("Open settings"))
        #expect(titles.contains("Restart server"))
        #expect(titles.contains("Session One"))
        #expect(titles.contains("Gmail"))
        #expect(titles.contains("Daily Review"))
        #expect(titles.contains("Team Meeting"))
    }

    @Test("search filters integrations by label")
    func searchFiltersIntegrations() throws {
        let view = makeView(
            integrations: [
                makeIntegration(label: "Gmail", key: "gmail"),
                makeIntegration(label: "Todoist", key: "todoist"),
            ]
        )
        let results = view.results(for: "todo")
        let titles = results.map { $0.title }
        #expect(titles.contains("Todoist"))
        #expect(!titles.contains("Gmail"))
    }

    @Test("search filters schedules by name and prompt")
    func searchFiltersSchedules() throws {
        let view = makeView(
            schedules: [
                makeSchedule(id: "sch1", name: "Daily Review", prompt: "Review tasks"),
                makeSchedule(id: "sch2", name: "Weekly Standup", prompt: "Check email"),
            ]
        )
        let results = view.results(for: "review")
        let titles = results.map { $0.title }
        #expect(titles.contains("Daily Review"))
        #expect(!titles.contains("Weekly Standup"))
    }

    @Test("search filters recordings by name")
    func searchFiltersRecordings() throws {
        let view = makeView(
            recordings: [
                makeRecording(id: "rec1", name: "Team Meeting"),
                makeRecording(id: "rec2", name: "Personal Note"),
            ]
        )
        let results = view.results(for: "team")
        let titles = results.map { $0.title }
        #expect(titles.contains("Team Meeting"))
        #expect(!titles.contains("Personal Note"))
    }

    @Test("search filters sessions by name")
    func searchFiltersSessions() throws {
        let view = makeView(
            sessions: [
                SessionSummary(id: "s1", name: "Project Planning", createdAt: nil, updatedAt: nil),
                SessionSummary(id: "s2", name: "Grocery List", createdAt: nil, updatedAt: nil),
            ]
        )
        let results = view.results(for: "project")
        let titles = results.map { $0.title }
        #expect(titles.contains("Project Planning"))
        #expect(!titles.contains("Grocery List"))
    }

    @Test("result kinds reflect entity types")
    func resultKindsReflectEntityTypes() throws {
        let view = makeView(
            sessions: [SessionSummary(id: "s1", name: "Session", createdAt: nil, updatedAt: nil)],
            integrations: [makeIntegration(label: "Gmail", key: "gmail")],
            schedules: [makeSchedule(id: "sch1", name: "Schedule")],
            recordings: [makeRecording(id: "rec1", name: "Recording")]
        )
        let results = view.results(for: "")
        let action = results.first { $0.id == "action-new-chat" }
        #expect(action?.kind == .action)
        let restart = results.first { $0.id == "action-restart-server" }
        #expect(restart?.kind == .action)
        let session = results.first { $0.id == "session-s1" }
        #expect(session?.kind == .session("s1"))
        let integration = results.first { $0.id == "integration-gmail" }
        #expect(integration?.kind == .integration("gmail"))
        let schedule = results.first { $0.id == "schedule-sch1" }
        #expect(schedule?.kind == .schedule("sch1"))
        let recording = results.first { $0.id == "recording-rec1" }
        #expect(recording?.kind == .recording("rec1"))
    }

    @Test("selecting an integration opens it via callback")
    func selectIntegrationCallback() throws {
        var selectedNavKey: String?
        let view = makeView(
            integrations: [makeIntegration(label: "Gmail", key: "gmail", navKey: "integrations.gmail")],
            onOpenIntegration: { selectedNavKey = $0 },
            onDismiss: {}
        )
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        let integrationButton = buttons.first { btn in
            (try? btn.find(text: "Gmail")) != nil
        }
        try #require(integrationButton != nil, "Integration button not found")
        try integrationButton!.tap()
        #expect(selectedNavKey == "integrations.gmail")
    }

    @Test("selecting a schedule opens it via callback")
    func selectScheduleCallback() throws {
        var selectedId: String?
        let view = makeView(
            schedules: [makeSchedule(id: "sch1", name: "Daily Review")],
            onOpenSchedule: { selectedId = $0 },
            onDismiss: {}
        )
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        let scheduleButton = buttons.first { btn in
            (try? btn.find(text: "Daily Review")) != nil
        }
        try #require(scheduleButton != nil, "Schedule button not found")
        try scheduleButton!.tap()
        #expect(selectedId == "sch1")
    }

    @Test("selecting a recording opens it via callback")
    func selectRecordingCallback() throws {
        var selectedId: String?
        let view = makeView(
            recordings: [makeRecording(id: "rec1", name: "Team Meeting")],
            onOpenRecording: { selectedId = $0 },
            onDismiss: {}
        )
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        let recordingButton = buttons.first { btn in
            (try? btn.find(text: "Team Meeting")) != nil
        }
        try #require(recordingButton != nil, "Recording button not found")
        try recordingButton!.tap()
        #expect(selectedId == "rec1")
    }

    @Test("selecting a session opens it via callback")
    func selectSessionCallback() throws {
        var selectedId: String?
        let view = makeView(
            sessions: [SessionSummary(id: "s1", name: "My Session", createdAt: nil, updatedAt: nil)],
            onSelectSession: { selectedId = $0 },
            onDismiss: {}
        )
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        let sessionButton = buttons.first { btn in
            (try? btn.find(text: "My Session")) != nil
        }
        try #require(sessionButton != nil, "Session button not found")
        try sessionButton!.tap()
        #expect(selectedId == "s1")
    }

    @Test("search finds restart server action")
    func searchFindsRestartServerAction() throws {
        let view = makeView()
        let results = view.results(for: "server")
        #expect(results.contains { $0.id == "action-restart-server" })
    }

    @Test("selecting restart server action calls callback")
    func selectRestartServerCallback() throws {
        var didRestart = false
        var didDismiss = false
        let view = makeView(
            onRestartServer: { didRestart = true },
            onDismiss: { didDismiss = true }
        )
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        let restartButton = buttons.first { btn in
            (try? btn.find(text: "Restart server")) != nil
        }
        try #require(restartButton != nil, "Restart server button not found")
        try restartButton!.tap()
        #expect(didRestart)
        #expect(didDismiss)
    }
}
