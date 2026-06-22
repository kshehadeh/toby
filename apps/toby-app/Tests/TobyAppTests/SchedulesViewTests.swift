import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("SchedulesView")
struct SchedulesViewTests {
	@Test("schedules view uses navigation split view with sidebar")
	func schedulesViewUsesNavigationSplitView() throws {
		let view = SchedulesView(store: SchedulesStore())
		let splitView = try view.inspect().navigationSplitView()
		#expect(throws: Never.self) { try splitView.sidebarView() }
		#expect(throws: Never.self) { try splitView.detailView() }
	}

	@Test("schedule detail shows frequency hint and crontab link")
	func scheduleDetailShowsFrequencyHint() throws {
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
			try view.inspect().find(text: "Accepts a cron expression or a plain-language description like “every weekday at 9am”.")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Learn how to write a crontab")
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
}
