import Foundation
import GRDB
import TobyAI

extension FeedService {
	/// A lost response is ambiguous. Inspect the original target on refresh
	/// before exposing it again. Recovery never repeats the remote mutation.
	func reconcilePendingActions() async {
		do {
			for (id, entry) in try storage.pendingActions() {
				guard activeActions.insert(id).inserted else { continue }
				defer { activeActions.remove(id) }
				do { try await reconcile(id, entry) } catch {
					TobyLog.shared.warn("feed", "pending_action_check_failed", ["error": .string(error.localizedDescription)])
				}
			}
		} catch {
			TobyLog.shared.warn("feed", "pending_actions_unavailable", ["error": .string(error.localizedDescription)])
		}
	}

	private func reconcile(_ id: String, _ entry: JSONValue) async throws {
		guard let source = entry["source"], let provider = source["providerName"]?.stringValue,
		      let target = source["itemId"]?.stringValue, let action = entry["action"]?.stringValue,
		      let standard = FeedActions.providerActions[action],
		      let service = sources.first(where: { $0.providerName == provider }) else { return }
		let handled: Bool
		if let mail = service as? MailFeedSource {
			handled = try await mail.mail.feedAction(standard, itemID: target, identity: source["identity"], inspectOnly: true)
		} else if let reminders = service as? RemindersFeedSource {
			let reminder = try await reminders.apple.bridge.data("reminders/get", ["id": .string(target)])
			handled = reminder["isCompleted"] == true || (reminder["isRecurring"] == true && source["identity"]?["occurrence"] != reminder["dueDate"])
		} else { return }
		try await storage.writer.write { db in
			guard try String.fetchOne(db, sql: "SELECT decision FROM feed_decisions WHERE item_id = ?", arguments: [id]) == entry.jsonString() else { return }
			if handled {
				try FeedDatabase.record(id, ["kind": "done", "at": entry["at"] ?? .null, "action": .string(action)], db)
			} else {
				try db.execute(sql: "DELETE FROM feed_decisions WHERE item_id = ?", arguments: [id])
			}
		}
	}
}
