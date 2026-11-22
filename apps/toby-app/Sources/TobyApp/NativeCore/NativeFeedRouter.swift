import Foundation
import TobyAI
import TobyCore
import UserNotifications

/// In-process `/api/dashboard/feed*` (native mode). Responses match the
/// daemon handlers so `FeedContent` / `FeedActionResponse` decode unchanged.
struct NativeFeedRouter: Sendable {
	let feed: FeedService

	private func run(_ body: () async throws -> JSONValue) async throws -> Data {
		do {
			return Data(try await body().jsonString().utf8)
		} catch let error as TodoError {
			throw TobyClientError.serverError(error.message)
		}
	}

	func content(fresh: Bool) async throws -> Data { try await run { try await feed.content(force: fresh) } }
	func perform(itemID: String, actionID: String) async throws -> Data {
		try await run { try await feed.perform(itemID: itemID, actionID: actionID) }
	}
	func instructions() async throws -> Data { try await run { await feed.instructions() } }
	func addInstruction(_ text: String) async throws -> Data { try await run { try await feed.addInstruction(text) } }
	func setInstruction(_ id: String, enabled: Bool) async throws -> Data { try await run { try await feed.setInstruction(id, enabled: enabled) } }
	func removeInstruction(_ id: String) async throws -> Data { try await run { try await feed.removeInstruction(id) } }

	/// Post a "now" Feed item as a local notification.
	@Sendable static func notify(_ item: JSONValue) async {
		let content = UNMutableNotificationContent()
		content.title = item["title"]?.stringValue ?? "The Feed"
		content.body = item["reason"]?.stringValue ?? ""
		content.threadIdentifier = "toby.feed"
		let request = UNNotificationRequest(identifier: "feed:\(item["id"]?.stringValue ?? UUID().uuidString)", content: content, trigger: nil)
		try? await UNUserNotificationCenter.current().add(request)
	}
}
