import Foundation
import UserNotifications

/// One retained delegate and one category registry for Flows and Todos.
@MainActor
enum NativeNotificationCoordinator {
	private static let delegate = NativeNotificationDelegate()
	private static var categories: [String: UNNotificationCategory] = [:]

	static func install() {
		UNUserNotificationCenter.current().delegate = delegate
	}

	static func register(_ additions: [UNNotificationCategory]) async {
		install()
		let center = UNUserNotificationCenter.current()
		let existing = await center.notificationCategories()
		for category in existing where categories[category.identifier] == nil {
			categories[category.identifier] = category
		}
		for category in additions { categories[category.identifier] = category }
		center.setNotificationCategories(Set(categories.values))
	}
}

private final class NativeNotificationDelegate: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
	func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		willPresent notification: UNNotification,
		withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
	) {
		completionHandler([.banner, .list, .sound])
	}

	func userNotificationCenter(
		_ center: UNUserNotificationCenter,
		didReceive response: UNNotificationResponse,
		withCompletionHandler completionHandler: @escaping () -> Void
	) {
		let info = response.notification.request.content.userInfo
		if info["type"] as? String == "flowCompletion", let runId = info["runId"] as? String {
			DispatchQueue.main.async { NotificationCenter.default.post(name: .openFlowRun, object: runId) }
		} else if info["type"] as? String == "todo",
			let occurrenceId = info["occurrenceId"] as? String,
			let home = info["home"] as? String {
			let action = response.actionIdentifier
			let reminderId = info["reminderId"] as? String
			Task { @MainActor in
				await TodoNotificationScheduler.shared.respond(
					action: action, occurrenceId: occurrenceId, reminderId: reminderId, home: home
				)
			}
		} else if info["type"] as? String == "todoCatchUp" {
			DispatchQueue.main.async { NotificationCenter.default.post(name: .navigateToRoute, object: DetailRoute.todos.rawValue) }
		}
		completionHandler()
	}
}
