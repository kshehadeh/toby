import SwiftUI

struct TodoNotificationSettingsSection: View {
	@Bindable var scheduler: TodoNotificationScheduler = .shared

	var body: some View {
		Section("Todo reminders on this Mac") {
			Toggle("Enable notifications", isOn: Binding(
				get: { scheduler.enabled },
				set: { value in Task { await scheduler.setEnabled(value) } }
			))
			.accessibilityIdentifier("todo-notifications-enabled")
			Text(scheduler.status).font(.caption).foregroundStyle(.secondary)
			if let error = scheduler.errorMessage {
				InlineStatusMessage(message: error, tone: .error, font: .caption)
			}
			Button("Update reminder schedule") { Task { await scheduler.reconcile() } }
				.disabled(!scheduler.enabled)
			Text("Each enabled Mac schedules its own reminders. Scheduled alerts can fire while Toby is closed. Changes must reach this Mac before Toby can schedule them. Focus and macOS notification settings may silence alerts.")
				.font(.caption).foregroundStyle(.secondary)
		}
	}
}
