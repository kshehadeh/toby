import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("SchedulesView")
struct SchedulesViewTests {
	@Test("schedules view renders detail content")
	func schedulesViewRendersDetailContent() throws {
		let view = SchedulesView(store: SchedulesStore())
		#expect(throws: Never.self) { try view.inspect().find(SchedulesDetailView.self) }
	}

	@Test("empty schedules state shows schedule overview and create action")
	func emptySchedulesStateShowsCreateAction() throws {
		let store = SchedulesStore()
		let view = SchedulesDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "feature-browser-placeholder")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "empty-create-schedule-button")
		}
	}

	@Test("unselected schedules show cards")
	func unselectedSchedulesShowCards() throws {
		let store = SchedulesStore()
		store.schedules = [
			ScheduleViewModel(
				id: "daily-review",
				name: "Daily Review",
				prompt: "Review my tasks",
				personaName: "Toby",
				cronExpression: "0 9 * * *",
				cronHumanReadable: "At 09:00 AM",
				nextRunAt: nil,
				enabled: true,
				lastRunAt: nil,
				recentRuns: []
			),
			ScheduleViewModel(
				id: "weekly-brief",
				name: "Weekly Brief",
				prompt: "Summarize my week",
				personaName: "Toby",
				cronExpression: "0 9 * * 1",
				cronHumanReadable: "At 09:00 AM on Monday",
				nextRunAt: nil,
				enabled: false,
				lastRunAt: nil,
				recentRuns: []
			),
		]
		let detail = SchedulesDetailView(store: store)
		#expect(throws: Never.self) {
			try detail.inspect().find(viewWithAccessibilityIdentifier: "feature-browser-placeholder")
		}
		let list = SchedulesSidebarView(store: store, onDelete: { _ in })
		#expect(throws: Never.self) {
			try list.inspect().find(text: "Daily Review")
		}
		#expect(throws: Never.self) {
			try list.inspect().find(text: "Weekly Brief")
		}
	}

	@Test("schedules sidebar omits the redundant overview button")
	func schedulesSidebarOmitsOverviewButton() throws {
		let store = SchedulesStore()
		let view = SchedulesSidebarView(store: store, onDelete: { _ in })
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "schedules-home-button")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "New Schedule")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "create-schedule-button")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "Add Schedule")
		}
	}

	@Test("select home clears the selected schedule")
	func selectHomeClearsSelection() {
		let store = SchedulesStore()
		store.selectedScheduleId = "daily-review"
		store.selectedRunId = "run-1"
		store.selectHome()
		#expect(store.selectedScheduleId == nil)
		#expect(store.selectedRunId == nil)
	}

	@Test("schedules sidebar empty-area tap clears selection")
	func schedulesSidebarEmptyAreaTapClearsSelection() throws {
		let store = SchedulesStore()
		store.schedules = [
			ScheduleViewModel(
				id: "daily-review",
				name: "Daily Review",
				prompt: "Review my tasks",
				personaName: "Toby",
				cronExpression: "0 9 * * *",
				cronHumanReadable: "At 09:00 AM",
				nextRunAt: nil,
				enabled: true,
				lastRunAt: nil,
				recentRuns: []
			),
		]
		store.selectedScheduleId = "daily-review"
		let view = SchedulesSidebarView(store: store, onDelete: { _ in })
		let target = try view.inspect().find(
			viewWithAccessibilityIdentifier: "feature-browser-list-deselect"
		)
		try target.button().tap()
		#expect(store.selectedScheduleId == nil)
	}

	@Test("schedule detail shows details and prompt tabs")
	func scheduleDetailShowsDetailsAndPromptTabs() throws {
		let store = SchedulesStore()
		let schedule = ScheduleViewModel(
			id: "schedule-1",
			name: "Daily Standup",
			prompt: "Summarize",
			personaName: "default",
			cronExpression: "0 9 * * *",
			cronHumanReadable: "At 09:00 AM",
			nextRunAt: nil,
			enabled: true,
			lastRunAt: nil,
			recentRuns: []
		)
		store.schedules = [schedule]
		store.selectedScheduleId = schedule.id
		#expect(store.selectedDetailTab == .details)
		let view = ScheduleDetailContent(store: store, schedule: schedule)
		#expect(throws: Never.self) {
			try view.inspect().tabView()
		}
		let details = detailsPane(store: store, schedule: schedule)
		#expect(throws: Never.self) {
			try details.inspect().find(viewWithAccessibilityIdentifier: "schedule-detail-name")
		}
		#expect(throws: Never.self) {
			try details.inspect().find(text: "Enabled")
		}
		#expect(throws: (any Error).self) {
			try details.inspect().find(viewWithAccessibilityIdentifier: "schedule-action-picker")
		}
		#expect(throws: Never.self) {
			try details.inspect().find(text: "Daily Standup")
		}
		#expect(throws: Never.self) {
			try details.inspect().find(text: "Recent runs")
		}

		store.selectedDetailTab = .prompt
		#expect(store.selectedDetailTab == .prompt)
		#expect(throws: Never.self) {
			try promptPane(store: store, schedule: schedule).inspect().find(
				text: "Sent to Toby when this schedule runs"
			)
		}
	}

	@Test("selecting a schedule resets the detail tab to details")
	func selectingScheduleResetsDetailTab() async {
		let store = SchedulesStore()
		store.schedules = [
			ScheduleViewModel(
				id: "a",
				name: "A",
				prompt: "A",
				personaName: "Toby",
				cronExpression: "0 9 * * *",
				cronHumanReadable: "At 09:00 AM",
				nextRunAt: nil,
				enabled: true,
				lastRunAt: nil,
				recentRuns: []
			),
			ScheduleViewModel(
				id: "b",
				name: "B",
				prompt: "B",
				personaName: "Toby",
				cronExpression: "0 10 * * *",
				cronHumanReadable: "At 10:00 AM",
				nextRunAt: nil,
				enabled: true,
				lastRunAt: nil,
				recentRuns: []
			),
		]
		store.selectedScheduleId = "a"
		store.selectedDetailTab = .prompt
		await store.selectSchedule(id: "b")
		#expect(store.selectedDetailTab == .details)
	}

	@Test("schedule detail shows prompt and inspect fields, not editors")
	func scheduleDetailShowsPromptAndFields() throws {
		let store = SchedulesStore()
		let schedule = ScheduleViewModel(
			id: "schedule-1",
			name: "Daily Standup",
			prompt: "Summarize",
			personaName: "default",
			cronExpression: "0 9 * * *",
			cronHumanReadable: "At 09:00 AM",
			nextRunAt: nil,
			enabled: true,
			lastRunAt: nil,
			recentRuns: []
		)
		store.schedules = [schedule]
		store.selectedScheduleId = schedule.id
		#expect(throws: Never.self) {
			try promptPane(store: store, schedule: schedule).inspect().find(
				text: "Sent to Toby when this schedule runs"
			)
		}
		let details = detailsPane(store: store, schedule: schedule)
		#expect(throws: Never.self) {
			try details.inspect().find(viewWithAccessibilityIdentifier: "schedule-detail-name")
		}
		#expect(throws: Never.self) {
			try details.inspect().find(text: "Enabled")
		}
		#expect(throws: (any Error).self) {
			try details.inspect().find(viewWithAccessibilityIdentifier: "schedule-action-picker")
		}
		#expect(throws: Never.self) {
			try details.inspect().find(text: "Daily Standup")
		}
		#expect(throws: (any Error).self) {
			try details.inspect().find(viewWithAccessibilityIdentifier: "skill-icon-edit-button")
		}
	}

	@Test("flow schedule shows flow summary and hides prompt editor")
	func flowScheduleShowsFlowPicker() throws {
		let store = SchedulesStore()
		let schedule = ScheduleViewModel(
			id: "schedule-flow",
			name: "Morning brief",
			prompt: "",
			personaName: "Toby",
			flowId: "dashboard.email",
			cronExpression: "0 9 * * *",
			cronHumanReadable: "At 09:00 AM",
			nextRunAt: nil,
			enabled: true,
			lastRunAt: nil,
			recentRuns: []
		)
		store.schedules = [schedule]
		store.selectedScheduleId = schedule.id
		store.values = [
			"schedules.schedule-flow.action": "flow",
			"schedules.schedule-flow.flow": "dashboard.email",
		]
		store.flowOptions = [
			FlowListItem(
				id: "dashboard.email",
				name: "Email summary",
				description: "Unread mail blurb",
				icon: "sparkles",
				builtin: true,
				persona: nil,
				nodes: [],
				result: nil,
				destinations: nil,
				createdAt: nil,
				updatedAt: nil
			),
		]
		#expect(throws: Never.self) {
			try detailsPane(store: store, schedule: schedule).inspect().find(text: "Email summary")
		}
		#expect(throws: (any Error).self) {
			try detailsPane(store: store, schedule: schedule).inspect().find(
				viewWithAccessibilityIdentifier: "schedule-flow-picker"
			)
		}
		#expect(throws: Never.self) {
			try promptPane(store: store, schedule: schedule).inspect().find(
				text: "This schedule runs the selected flow instead of a chat prompt."
			)
		}
		#expect(throws: (any Error).self) {
			try promptPane(store: store, schedule: schedule).inspect().find(
				text: "Sent to Toby when this schedule runs"
			)
		}
		store.startEdit(id: schedule.id)
		#expect(throws: Never.self) {
			try ScheduleEditorDetailsPane(store: store).inspect().find(
				viewWithAccessibilityIdentifier: "schedule-flow-picker"
			)
		}
	}

	@Test("schedule detail omits run now and delete buttons in sidebar")
	func scheduleDetailOmitsSidebarActions() throws {
		let store = SchedulesStore()
		let schedule = ScheduleViewModel(
			id: "schedule-1",
			name: "Daily Standup",
			prompt: "Summarize",
			personaName: "default",
			cronExpression: "0 9 * * *",
			cronHumanReadable: "At 09:00 AM",
			nextRunAt: nil,
			enabled: true,
			lastRunAt: nil,
			recentRuns: []
		)
		store.schedules = [schedule]
		store.selectedScheduleId = schedule.id
		let view = SchedulesView(store: store)
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "sidebar-run-now-button")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "sidebar-delete-schedule-button")
		}
	}

	@Test("schedule editor shows validate button for cron field")
	func scheduleDetailShowsValidateButton() throws {
		let store = SchedulesStore()
		let schedule = ScheduleViewModel(
			id: "schedule-1",
			name: "Daily Standup",
			prompt: "Summarize",
			personaName: "default",
			cronExpression: "0 9 * * *",
			cronHumanReadable: "At 09:00 AM",
			nextRunAt: nil,
			enabled: true,
			lastRunAt: nil,
			recentRuns: []
		)
		store.schedules = [schedule]
		store.selectedScheduleId = schedule.id
		store.values[store.key(for: schedule.id, field: .cron)] = schedule.cronExpression
		store.startEdit(id: schedule.id)
		#expect(throws: Never.self) {
			try ScheduleEditorDetailsPane(store: store).inspect().find(
				viewWithAccessibilityIdentifier: "validate-schedule-button"
			)
		}
		#expect(throws: (any Error).self) {
			try detailsPane(store: store, schedule: schedule).inspect().find(
				viewWithAccessibilityIdentifier: "validate-schedule-button"
			)
		}
	}

	@Test("cron blur validation does not treat natural language as a hard error")
	func cronBlurValidationDoesNotErrorNaturalLanguage() throws {
		let store = SchedulesStore()
		store.editor = ScheduleEditorDraft.blank()
		store.editor?.cron = "every weekday at 9am"
		store.validateEditorCronOnBlur()
		#expect(store.editorCronError == nil)
		#expect(store.isEditorCronValid == false)
	}

	@Test("cron blur validation clears error for valid expression")
	func cronBlurValidationClearsError() throws {
		let store = SchedulesStore()
		store.editor = ScheduleEditorDraft.blank()
		store.editorCronError = "existing error"
		store.editor?.cron = "0 9 * * *"
		store.validateEditorCronOnBlur()
		#expect(store.editorCronError == nil)
	}

	@Test("cron blur validation is skipped while conversion is in flight")
	func cronBlurValidationSkippedWhileParsing() throws {
		let store = SchedulesStore()
		store.editor = ScheduleEditorDraft.blank()
		store.editor?.cron = "every weekday at 9am"
		store.parsingCronScheduleId = "editor"
		store.validateEditorCronOnBlur()
		#expect(store.editorCronError == nil)
		#expect(store.isParsingEditorCron)
	}

	@Test("cron validity does not treat plain language with numbers as cron")
	func cronValidityRejectsPlainLanguageWithNumbers() throws {
		let store = SchedulesStore()
		store.editor = ScheduleEditorDraft.blank()
		store.editor?.cron = "every 2 days at 9am"
		#expect(store.isEditorCronValid == false)
	}

	@Test("schedule detail shows converting status while parsing cron")
	func scheduleDetailShowsConvertingStatus() throws {
		let store = SchedulesStore()
		let schedule = ScheduleViewModel(
			id: "schedule-1",
			name: "Daily Standup",
			prompt: "Summarize",
			personaName: "default",
			cronExpression: "0 9 * * *",
			cronHumanReadable: "At 09:00 AM",
			nextRunAt: nil,
			enabled: true,
			lastRunAt: nil,
			recentRuns: []
		)
		store.schedules = [schedule]
		store.selectedScheduleId = schedule.id
		store.startEdit(id: schedule.id)
		store.editor?.cron = "every weekday at 9am"
		store.parsingCronScheduleId = "editor"
		#expect(throws: Never.self) {
			try ScheduleEditorDetailsPane(store: store).inspect().find(
				viewWithAccessibilityIdentifier: "cron-converting-status"
			)
		}
		#expect(throws: Never.self) {
			try ScheduleEditorDetailsPane(store: store).inspect().find(
				text: "Converting natural language to cron…"
			)
		}
	}

	@Test("schedule detail shows convert hint for natural language cron")
	func scheduleDetailShowsConvertHint() throws {
		let store = SchedulesStore()
		let schedule = ScheduleViewModel(
			id: "schedule-1",
			name: "Daily Standup",
			prompt: "Summarize",
			personaName: "default",
			cronExpression: "0 9 * * *",
			cronHumanReadable: "At 09:00 AM",
			nextRunAt: nil,
			enabled: true,
			lastRunAt: nil,
			recentRuns: []
		)
		store.schedules = [schedule]
		store.selectedScheduleId = schedule.id
		store.startEdit(id: schedule.id)
		store.editor?.cron = "every weekday at 9am"
		#expect(throws: Never.self) {
			try ScheduleEditorDetailsPane(store: store).inspect().find(
				viewWithAccessibilityIdentifier: "cron-needs-convert-hint"
			)
		}
	}

	@Test("run view model withStatus rewrites label and normalizes status")
	func runViewModelWithStatusRewritesLabel() {
		let run = ScheduleRunViewModel(
			id: "run-1",
			label: "7/15/2026, 3:01:11 PM · RUNNING",
			status: "running",
			startedAt: "2026-07-15T15:01:11Z"
		)
		let updated = run.withStatus("success")
		#expect(updated.status == "success")
		#expect(updated.label == "7/15/2026, 3:01:11 PM · SUCCESS")
		#expect(updated.id == run.id)
		#expect(updated.startedAt == run.startedAt)
	}

	@Test("applyRunDetailToSchedules syncs list status from live run detail")
	func applyRunDetailSyncsListStatus() {
		let store = SchedulesStore()
		let run = ScheduleRunViewModel(
			id: "run-1",
			label: "7/15/2026, 3:01:11 PM · RUNNING",
			status: "running",
			startedAt: "2026-07-15T15:01:11Z"
		)
		store.schedules = [
			ScheduleViewModel(
				id: "schedule-1",
				name: "Email Checker",
				prompt: "Check email",
				personaName: "Audrey",
				cronExpression: "0 9 * * *",
				cronHumanReadable: "At 09:00 AM",
				nextRunAt: nil,
				enabled: true,
				lastRunAt: nil,
				recentRuns: [run]
			),
		]
		let detail = ScheduleRunDetail(
			id: "run-1",
			scheduleId: "schedule-1",
			scheduleName: "Email Checker",
			personaName: "Audrey",
			prompt: "Check email",
			output: "done",
			status: "success",
			error: nil,
			startedAt: "2026-07-15T15:01:11Z",
			completedAt: "2026-07-15T15:02:26Z",
			transcript: []
		)
		store.applyRunDetailToSchedules(detail)
		#expect(store.schedules.first?.recentRuns.first?.status == "success")
		#expect(store.schedules.first?.recentRuns.first?.label == "7/15/2026, 3:01:11 PM · SUCCESS")
	}

	@Test("startCreate opens a draft without adding a schedule")
	func startCreateDoesNotAddScheduleUntilSave() throws {
		let store = SchedulesStore()
		store.startCreate()
		#expect(store.schedules.isEmpty)
		#expect(store.editor?.isNew == true)
		#expect(store.isEditorDirty == false)
		var draft = store.editor!
		draft.name = "Morning brief"
		store.editor = draft
		#expect(store.isEditorDirty == true)
		store.cancelEditor()
		#expect(store.editor == nil)
		#expect(store.schedules.isEmpty)

		store.startCreate()
		let pane = ScheduleEditorDetailsPane(store: store)
		#expect(throws: Never.self) {
			try pane.inspect().find(viewWithAccessibilityIdentifier: "schedule-title-field")
		}
		#expect(throws: Never.self) {
			try ScheduleEditorSheet(store: store).inspect().find(
				viewWithAccessibilityIdentifier: "schedule-editor-sheet"
			)
		}
		#expect(throws: Never.self) {
			try ScheduleEditorSheet(store: store).inspect().find(
				viewWithAccessibilityIdentifier: "schedule-editor-tabs"
			)
		}
	}
}

@MainActor
private func detailsPane(store: SchedulesStore, schedule: ScheduleViewModel) -> ScheduleDetailsPane {
	ScheduleDetailsPane(store: store, schedule: schedule)
}

@MainActor
private func promptPane(store: SchedulesStore, schedule: ScheduleViewModel) -> SchedulePromptPane {
	SchedulePromptPane(store: store, schedule: schedule)
}
