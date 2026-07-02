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
}
