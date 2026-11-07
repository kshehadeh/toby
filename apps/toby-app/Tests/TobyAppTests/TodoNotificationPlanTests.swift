import Foundation
import Testing
@testable import TobyApp

@Suite("Todo notification scheduling")
struct TodoNotificationPlanTests {
	private let now = Date(timeIntervalSince1970: 1_800_000_000)
	private func reminder(_ id: Int, seconds: Double) -> TodoScheduledReminder {
		TodoScheduledReminder(todoId: "todo", occurrenceId: "todo:0", sequence: 0, reminderId: "\(id)",
			title: "Synthetic todo", at: ISO8601DateFormatter().string(from: now.addingTimeInterval(seconds)))
	}

	@Test("Restores suppress both future requests and catch-up replay")
	func restorePause() {
		let schedule = TodoReminderSchedule(pausedForRestore: true, reminders: [reminder(1, seconds: 60), reminder(2, seconds: -60)])
		let plan = TodoNotificationPlan(schedule: schedule, now: now, accounted: [], suppressBefore: .distantPast)
		#expect(plan.future.isEmpty && plan.missed.isEmpty)
	}

	@Test("Only unaccounted missed reminders enter a single catch-up summary")
	func catchUp() {
		let missed = reminder(1, seconds: -10)
		let scheduled = reminder(2, seconds: -5)
		let schedule = TodoReminderSchedule(pausedForRestore: false, reminders: [missed, scheduled, reminder(3, seconds: 60)])
		let plan = TodoNotificationPlan(schedule: schedule, now: now, accounted: [scheduled.key], suppressBefore: .distantPast)
		#expect(plan.missed == [missed])
		#expect(plan.future.count == 1)
		let restored = TodoNotificationPlan(schedule: schedule, now: now, accounted: [], suppressBefore: now)
		#expect(restored.missed.isEmpty)
	}

	@Test("Schedule stays bounded and prioritizes the next deadlines")
	func boundedSchedule() {
		let schedule = TodoReminderSchedule(pausedForRestore: false, reminders: (1...100).reversed().map { reminder($0, seconds: Double($0 * 60)) })
		let plan = TodoNotificationPlan(schedule: schedule, now: now, accounted: [], suppressBefore: .distantPast)
		#expect(plan.future.count == 50)
		#expect(plan.future.first?.reminderId == "1")
		#expect(plan.future.last?.reminderId == "50")
	}
}
