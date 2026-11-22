import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Opt-in: read a copied home's Feed files the way the app shows them.
@Suite("Feed parity smoke (opt-in)")
struct FeedParitySmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_FEED_PARITY_DIR"] != nil))
	func dumps() async throws {
		let home = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TOBY_FEED_PARITY_DIR"]!)
		let database = try TobyDatabase.inMemory()
		let feed = FeedService(
			sources: [], todos: TodoService(writer: database.writer, tobyDirectory: home), memory: MemoryService(writer: database.writer),
			personas: PersonaService(tobyDirectory: home), ai: OpenRouterClient(keyProvider: StaticAPIKey("unused")), tobyDirectory: home,
		)
		let persisted = try #require(await feed.persisted()?["content"])
		let ids = await feed.visible(persisted)["items"]?.arrayValue?.compactMap { $0["id"]?.stringValue } ?? []
		let out: JSONValue = ["instructions": await feed.instructions()["instructions"] ?? [], "visible": .array(ids.map(JSONValue.string)),
		                      "hidden": .array(await feed.hiddenIDs(feed.loadState(), now: Date()).sorted().map(JSONValue.string))]
		try Data(out.jsonString().utf8).write(to: home.appending(path: "n-feed.json"))
	}
}
