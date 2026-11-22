import Foundation
import TobyAI
import TobyCore
import UserNotifications

/// In-process `/api/followups*` (native mode); shapes match the daemon.
struct NativeFollowupsRouter: Sendable {
	let followups: FollowupService
	let configURL: URL

	private func run(_ body: () async throws -> JSONValue) async throws -> Data {
		do { return Data(try await body().jsonString().utf8) } catch let error as TodoError { throw TobyClientError.serverError(error.message) }
	}

	func runNow() async throws -> Data { try await run { FollowupService.statsJSON(await followups.runOnce()) } }
	func sources() async throws -> Data { try await run { ["sources": try await followups.sourcesJSON()] } }
	func instructions() async throws -> Data { try await run { ["instructions": try await followups.instructions()] } }
	func addInstruction(_ text: String) async throws -> Data {
		try await run { ["instruction": try await followups.saveInstruction(id: nil, text: text), "instructions": try await followups.instructions()] }
	}
	func updateInstruction(_ id: String, _ text: String) async throws -> Data {
		try await run { _ = try await followups.saveInstruction(id: id, text: text); return ["instructions": try await followups.instructions()] }
	}
	func deleteInstruction(_ id: String) async throws -> Data { try await run { try await followups.deleteInstruction(id); return ["instructions": try await followups.instructions()] } }

	/// Detail, or nil (404).
	func detail(_ id: String) async throws -> Data? {
		guard let value = try await followups.detail(id) else { return nil }
		return Data(value.jsonString().utf8)
	}

	func action(_ id: String, _ action: String, outcome: String?) async throws {
		switch action {
		case "reopen":
			guard try await followups.reopen(id) != nil else { throw TobyClientError.serverError("Todo is not completed") }
		case "feedback":
			guard outcome == "not_useful" else { throw TobyClientError.serverError("outcome must be not_useful") }
			guard try await followups.notUseful(id: id) else { throw TobyClientError.serverError("Follow-up not found") }
		default:
			throw TobyClientError.serverError("Not found")
		}
	}

	// MARK: Settings (config.json `followups`, as the daemon stored them)

	func readConfig() -> [String: JSONValue] {
		((try? Data(contentsOf: configURL)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) })?.objectValue ?? [:]
	}

	func settings() async throws -> Data {
		let config = readConfig()
		return Data(JSONValue.object(["followups": config["followups"] ?? [:], "graph": config["graph"] ?? [:]]).jsonString().utf8)
	}

	func saveSettings(_ body: Data) async throws -> Data {
		let incoming = try JSONDecoder().decode(JSONValue.self, from: body)
		var config = readConfig()
		if let followups = incoming["followups"] { config["followups"] = followups }
		if let graph = incoming["graph"] { config["graph"] = graph }
		try JSONEncoder.tobyPretty.encode(JSONValue.object(config)).write(to: configURL, options: .atomic)
		return try await settings()
	}

	@Sendable static func notifyCompleted(_ titles: [String]) async {
		let content = UNMutableNotificationContent()
		content.title = titles.count == 1 ? "Toby completed a follow-up" : "Toby completed \(titles.count) follow-ups"
		content.body = titles.prefix(3).joined(separator: ", ")
		try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "followups:\(UUID().uuidString)", content: content, trigger: nil))
	}
}
