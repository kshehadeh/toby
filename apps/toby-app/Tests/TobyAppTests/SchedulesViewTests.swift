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
			try view.inspect().find(text: "Schedules")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Schedules run recurring prompts through Toby's background daemon so routine work can happen automatically.")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "empty-create-schedule-button")
		}
	}

	@Test("schedule detail shows prompt editor and sidebar fields")
	func scheduleDetailShowsPromptAndSidebar() throws {
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
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Prompt")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Sent to Toby when this schedule runs")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Enabled")
		}
	}

	@Test("schedule detail shows run now and delete buttons in sidebar")
	func scheduleDetailShowsDeleteButton() throws {
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
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "sidebar-run-now-button")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "sidebar-delete-schedule-button")
		}
	}

	@Test("schedule detail shows validate button for cron field")
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
		let view = SchedulesView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "validate-schedule-button")
		}
	}

	@Test("cron blur validation sets error for invalid expression")
	func cronBlurValidationSetsError() throws {
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
		store.values[store.key(for: schedule.id, field: .cron)] = "not a cron"
		store.validateCronOnBlur(for: schedule.id)
		#expect(store.cronValidationErrors[schedule.id] != nil)
	}

	@Test("cron blur validation clears error for valid expression")
	func cronBlurValidationClearsError() throws {
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
		store.cronValidationErrors[schedule.id] = "existing error"
		store.values[store.key(for: schedule.id, field: .cron)] = "0 9 * * *"
		store.validateCronOnBlur(for: schedule.id)
		#expect(store.cronValidationErrors[schedule.id] == nil)
	}

	@Test("cron validity does not treat plain language with numbers as cron")
	func cronValidityRejectsPlainLanguageWithNumbers() throws {
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
		store.values[store.key(for: schedule.id, field: .cron)] = "every 2 days at 9am"
		#expect(store.isCronValid(for: schedule.id) == false)
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
}
