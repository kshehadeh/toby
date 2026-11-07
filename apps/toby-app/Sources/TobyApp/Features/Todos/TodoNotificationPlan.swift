import Foundation

struct TodoReminderSchedule: Decodable, Sendable {
	let pausedForRestore: Bool
	let reminders: [TodoScheduledReminder]
}

struct TodoScheduledReminder: Decodable, Equatable, Sendable {
	let todoId: String
	let occurrenceId: String
	let sequence: Int
	let reminderId: String
	let title: String
	let at: String

	var date: Date? { SyncTimestampFormatting.date(fromISO: at) }
	var key: String { "\(occurrenceId)/\(reminderId)/\(at)" }
}

struct TodoNotificationPlan {
	let future: [TodoScheduledReminder]
	let missed: [TodoScheduledReminder]

	init(schedule: TodoReminderSchedule, now: Date, accounted: Set<String>, suppressBefore: Date) {
		guard !schedule.pausedForRestore else { future = []; missed = []; return }
		let valid = schedule.reminders.filter { $0.date != nil }.sorted { $0.at < $1.at }
		future = Array(valid.filter { ($0.date ?? .distantPast) > now }.prefix(50))
		missed = valid.filter {
			guard let date = $0.date else { return false }
			return date <= now && date > suppressBefore && !accounted.contains($0.key)
		}
	}
}
