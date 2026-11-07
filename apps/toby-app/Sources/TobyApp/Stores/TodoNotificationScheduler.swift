import CryptoKit
import Foundation
import Observation
import UserNotifications

@Observable @MainActor
final class TodoNotificationScheduler {
	static let shared = TodoNotificationScheduler()
	var enabled = false
	var status = "Reminders are disabled on this Mac."
	var errorMessage: String?
	private let client: TobyClient
	private let defaults: UserDefaults
	private var working = false
	private var generation = UUID()
	private var home = ""

	init(client: TobyClient = TobyClient(), defaults: UserDefaults = .standard) {
		self.client = client
		self.defaults = defaults
		loadHome()
	}

	private var preferenceKey: String { "todos.notifications.\(home)" }
	private var prefix: String { "toby.todo.\(home)." }
	private static func homeId() -> String {
		SHA256.hash(data: Data(ConfigReader.resolveTobyDir().utf8)).map { String(format: "%02x", $0) }.joined()
	}
	private func loadHome() {
		home = Self.homeId()
		enabled = defaults.bool(forKey: "\(preferenceKey).enabled")
	}

	func setEnabled(_ value: Bool) async {
		let context = generation
		if value {
			do {
				let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
				guard context == generation else { return }
				guard granted else {
					errorMessage = "Enable Toby in System Settings → Notifications to receive reminders."
					return
				}
			} catch { errorMessage = error.localizedDescription; return }
		}
		enabled = value
		defaults.set(value, forKey: "\(preferenceKey).enabled")
		await reconcile()
	}

	func homeDidChange() async {
		let oldPrefix = prefix
		generation = UUID()
		loadHome()
		let center = UNUserNotificationCenter.current()
		let pending = await center.pendingNotificationRequests()
		center.removePendingNotificationRequests(withIdentifiers: pending.filter { $0.identifier.hasPrefix(oldPrefix) }.map(\.identifier))
		await reconcile()
	}

	func run() async {
		NativeNotificationCoordinator.install()
		while !Task.isCancelled {
			await reconcile()
			do { try await Task.sleep(for: .seconds(30)) } catch { break }
		}
	}

	func reconcile() async {
		guard !working else { return }
		working = true
		defer { working = false }
		let context = generation
		let center = UNUserNotificationCenter.current()
		do {
			let pending = await center.pendingNotificationRequests()
			guard context == generation else { return }
			let own = pending.filter { $0.identifier.hasPrefix(prefix) }
			guard enabled else {
				center.removePendingNotificationRequests(withIdentifiers: own.map(\.identifier))
				status = "Reminders are disabled on this Mac."
				return
			}
			let settings = await center.notificationSettings()
			guard context == generation else { return }
			guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
				center.removePendingNotificationRequests(withIdentifiers: own.map(\.identifier))
				status = "Notification permission is unavailable."
				errorMessage = "Enable Toby in System Settings → Notifications."
				return
			}
			let schedule: TodoReminderSchedule = try await client.todoRequest("/reminders/schedule")
			guard context == generation else { return }
			let now = Date()
			if schedule.pausedForRestore {
				center.removePendingNotificationRequests(withIdentifiers: own.map(\.identifier))
				defaults.set(now.timeIntervalSince1970, forKey: "\(preferenceKey).suppressBefore")
				status = "Paused until restored todos are reviewed."
				return
			}
			var accounted = Set(defaults.stringArray(forKey: "\(preferenceKey).accounted") ?? [])
			let cutoff = Date(timeIntervalSince1970: defaults.double(forKey: "\(preferenceKey).suppressBefore"))
			let plan = TodoNotificationPlan(schedule: schedule, now: now, accounted: accounted, suppressBefore: cutoff)
			await NativeNotificationCoordinator.register([Self.category])
			guard context == generation else { return }
			let wanted = Set(plan.future.map { identifier($0) })
			center.removePendingNotificationRequests(withIdentifiers: own.filter { !wanted.contains($0.identifier) }.map(\.identifier))
			for reminder in plan.future {
				guard let date = reminder.date else { continue }
				let id = identifier(reminder)
				if !own.contains(where: { $0.identifier == id && $0.content.userInfo["key"] as? String == reminder.key && $0.content.body == reminder.title }) {
					let content = UNMutableNotificationContent()
					content.title = "Todo reminder"
					content.body = reminder.title
					content.sound = .default
					content.categoryIdentifier = Self.category.identifier
					content.userInfo = ["type": "todo", "home": home, "occurrenceId": reminder.occurrenceId, "reminderId": reminder.reminderId, "key": reminder.key]
					let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, date.timeIntervalSinceNow), repeats: false)
					try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
					guard context == generation else {
						center.removePendingNotificationRequests(withIdentifiers: [id])
						return
					}
				}
				accounted.insert(reminder.key)
			}
			if !plan.missed.isEmpty {
				let content = UNMutableNotificationContent()
				content.title = "Missed todo reminders"
				content.body = "\(plan.missed.count) reminders need attention. Open Todos to review them."
				content.userInfo = ["type": "todoCatchUp", "home": home]
				try await center.add(UNNotificationRequest(identifier: "\(prefix)catch-up", content: content, trigger: nil))
				guard context == generation else { return }
				for reminder in plan.missed { accounted.insert(reminder.key) }
			}
			defaults.set(Array(accounted), forKey: "\(preferenceKey).accounted")
			let delivered = await center.deliveredNotifications()
			guard context == generation else { return }
			let observed = delivered.filter { $0.request.identifier.hasPrefix(prefix) }.count
			status = "\(plan.future.count) scheduled · \(observed) in Notification Center"
			errorMessage = nil
		} catch {
			if context == generation {
				status = "Waiting to update reminders."
				errorMessage = error.localizedDescription
			}
		}
	}

	private func identifier(_ reminder: TodoScheduledReminder) -> String {
		let id = SHA256.hash(data: Data("\(reminder.occurrenceId)/\(reminder.reminderId)".utf8)).map { String(format: "%02x", $0) }.joined()
		return "\(prefix)\(id)"
	}

	private static var category: UNNotificationCategory {
		UNNotificationCategory(identifier: "toby.todos.reminder", actions: [
			UNNotificationAction(identifier: "todo.open", title: "Open", options: [.foreground]),
			UNNotificationAction(identifier: "todo.complete", title: "Complete", options: [.foreground]),
			UNNotificationAction(identifier: "todo.snooze", title: "Snooze 10 minutes", options: [.foreground]),
		], intentIdentifiers: [])
	}

	func respond(action: String, occurrenceId: String, reminderId: String?, home: String) async {
		guard home == self.home else { return }
		NotificationCenter.default.post(name: .openTodo, object: occurrenceId)
		guard action == "todo.complete" || action == "todo.snooze" else { return }
		let parts = occurrenceId.split(separator: ":")
		guard parts.count == 2, let sequence = Int(parts[1]) else { return }
		let context = generation
		do {
			let todo = try await client.fetchTodo(String(parts[0]))
			guard context == generation, todo.sequence == sequence, todo.state.status == "open", !todo.deleted else { return }
			var input: [String: Any] = ["id": todo.id, "expectedRevision": todo.revision]
			if action == "todo.complete" {
				input["sequence"] = sequence
				input["idempotencyKey"] = "notification:complete:\(occurrenceId)"
				try await client.mutateTodo("complete", input: input)
			} else if let reminder = todo.reminders.first(where: { $0.id == reminderId }) {
				input["reminder"] = [
					"id": reminder.id, "at": reminder.at as Any? ?? NSNull(),
					"offsetMinutes": reminder.offsetMinutes as Any? ?? NSNull(),
					"snoozedUntil": ISO8601DateFormatter().string(from: Date().addingTimeInterval(600)),
				]
				try await client.mutateTodo("setReminder", input: input)
			}
			await reconcile()
		} catch {
			errorMessage = error.localizedDescription
		}
	}
}
