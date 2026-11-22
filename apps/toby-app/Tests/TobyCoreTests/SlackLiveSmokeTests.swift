import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Refuses token refresh so a live check never rotates the real tokens.
struct NoRefreshTransport: HTTPTransport {
	let inner = URLSessionTransport()
	func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
		precondition(request.url?.lastPathComponent != "oauth.v2.access", "live smoke must not refresh tokens")
		return try await inner.send(request)
	}
	func streamLines(_ request: URLRequest) async throws -> StreamedResponse { try await inner.streamLines(request) }
}

/// Opt-in, read-only: auth.test + mentions/DM search with a copied home's
/// Slack tokens (in memory). Prints counts only.
@Suite("Slack live smoke (opt-in)")
struct SlackLiveSmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_SLACK_LIVE_DIR"] != nil))
	func readsMentions() async throws {
		let paths = TobyPaths(root: URL(fileURLWithPath: ProcessInfo.processInfo.environment["TOBY_SLACK_LIVE_DIR"]!))
		let database = try TobyDatabase.open(paths: paths)
		let secrets = InMemorySecretStore()
		_ = try LegacyImporter(paths: paths, database: database, secrets: secrets, openRouterKeyStore: nil).run(force: true)
		let slack = SlackService(api: SlackAPI(secrets: secrets, transport: NoRefreshTransport()))
		let account = slack.api.account()
		print("SLACKLIVE method=\(account.authMethod) fresh=\(account.accessTokenIsFresh) inbound=\((try? account.inboundCredentials()) != nil)")
		guard account.accessTokenIsFresh else { print("SLACKLIVE skipped: token expired (refresh would rotate it)"); return }
		print("SLACKLIVE userIdResolved=\(try await slack.searchUserID() != nil)")
		let summary = try await slack.mentionsSummary()
		let items = summary["items"]?.arrayValue ?? []
		print("SLACKLIVE items=\(items.count) direct=\(summary["groups"]?[1]?["count"]?.intValue ?? -1) withURL=\(items.filter { $0["url"] != nil }.count) titled=\(items.filter { !($0["title"]?.stringValue ?? "").isEmpty }.count)")
	}
}
