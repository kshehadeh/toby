import Foundation
import GRDB
import Testing
import TobyAI
@testable import TobyCore
@testable import TobyStore

@Suite("Settings support")
struct SettingsSupportTests {
	static func fixture(_ name: String) throws -> JSONValue {
		try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent().appending(path: "Fixtures/\(name)")))
	}

	@Test func changelogAndIssueTitlesMatchTheDaemon() throws {
		let fixture = try Self.fixture("ts-changelog.json")
		for pair in fixture["changes"]?.arrayValue ?? [] {
			let line = pair[0]?.stringValue ?? ""
			let expected = pair[1] == .null ? nil : pair[1]
			#expect(Changelog.categorize(line) == expected, "line: \(line)")
		}
		for row in fixture["titles"]?.arrayValue ?? [] {
			#expect(IssueReport.title(type: row[0]!.stringValue!, details: row[1]!.stringValue!) == row[2]?.stringValue)
		}
		let release = Changelog.release(tag: "v1.0.0", url: "u", publishedAt: "p", body: "- feat: a\r\n- fix: b\r\n- chore: c")
		#expect(release["features"]?.arrayValue?.count == 1 && release["bugs"]?.arrayValue?.count == 1 && release["enhancements"]?.arrayValue?.count == 1)
		let url = IssueReport.fallback(type: "bug", details: "Broken", version: "1.0")["fallbackUrl"]?.stringValue ?? ""
		#expect(url.hasPrefix("https://github.com/kshehadeh/toby/issues/new?") && url.contains("labels=bug"))
	}

	@Test func configFileSetsNestedKeysAndKeepsOthers() throws {
		let home = try temporaryHome()
		try Data(#"{"listen":{"keep":1},"other":true}"#.utf8).write(to: home.appending(path: "config.json"))
		let config = AppConfigFile(tobyDirectory: home)
		try config.set([("listen.summaryPersona", "Toby"), ("chatInbound.enabled", true)])
		#expect(config.value("listen.keep") == 1)
		#expect(config.value("listen.summaryPersona") == "Toby")
		#expect(config.value("chatInbound.enabled") == true)
		#expect(config.value("other") == true)
		try config.set("listen.summaryPersona", nil)
		#expect(config.value("listen.summaryPersona") == nil)
	}

	@Test func logWritesQueriesAndRotates() throws {
		let home = try temporaryHome()
		let log = TobyLog(directory: home)
		log.info("mail", "mail_sync_complete", ["newCount": 2])
		log.warn("feed", "feed_refresh_failed", ["error": .string(String(repeating: "x", count: 300))])
		log.error("flows", "flow_run_failed")
		let all = log.query(.init())
		#expect(all["matched"] == 3)
		#expect(all["entries"]?[0]?["type"] == "flow_run_failed", "newest first")
		#expect(all["entries"]?[1]?["data"]?["error"]?.stringValue?.count == 201, "long strings truncated")
		let warns = log.query(.init(level: "WARN"))
		#expect(warns["matched"] == 1)
		#expect(warns["facets"]?["levels"]?.arrayValue?.compactMap { $0["name"]?.stringValue } == ["error", "warn", "info"], "level facet ignores the level filter")
		#expect(log.query(.init(query: "newcount"))["matched"] == 1)
		#expect(log.query(.init(limit: 2))["hasMore"] == true)
		let big = String(repeating: "y", count: 190)
		for index in 0 ..< 3000 { log.info("bulk", "line", ["i": .number(Double(index)), "pad": .string(big)]) }
		let size = try FileManager.default.attributesOfItem(atPath: home.appending(path: "logs/toby.log").path)[.size] as? Int ?? 0
		#expect(size <= TobyLog.maxBytes)
		#expect(log.entries().last?["data"]?["i"] == 2999)
	}

	@Test func slackTokenExchangeMapsToSecrets() throws {
		let now = Date(timeIntervalSince1970: 1_800_000_000)
		let patch = try SlackSignIn.tokens(from: ["ok": true, "team": ["id": "T1", "name": "Acme"],
		                                          "authed_user": ["access_token": "xoxp-1", "refresh_token": "xoxe-1", "expires_in": 43200]], now: now)
		#expect(patch["oauthUserToken"] == "xoxp-1")
		#expect(patch["oauthUserRefreshToken"] == "xoxe-1")
		#expect(patch["teamName"] == "Acme")
		#expect(patch["authMethod"] == "oauth")
		#expect(patch["oauthExpiresAt"] == TodoRecurrence.isoString(now.addingTimeInterval(43200)))
		#expect(throws: SlackError.self) { try SlackSignIn.tokens(from: ["ok": false, "error": "invalid_code"]) }
		let account = SlackAccount(patch.filter { !$0.value.isEmpty })
		#expect(account.hasAccessToken)
	}

	@Test func dashboardBlocksListHomeActionRunners() throws {
		let database = try TobyDatabase.inMemory()
		try database.writer.write { db in
			func insert(_ id: String, _ name: String, _ document: JSONValue, builtin: Bool = false) throws {
				try db.execute(sql: "INSERT INTO flows (id, name, description, definition_json, builtin, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, 'x', 'x')",
				               arguments: [id, name, document.jsonString(), builtin])
			}
			let runner: JSONValue = ["icon": "bolt", "destinations": [["type": "dashboard", "variant": "runner", "color": "blue"], ["type": "modal"]],
			                         "triggers": [["enabled": true, "source": ["type": "home.action"]]]]
			try insert("b", "beta", runner)
			try insert("a", "Alpha", runner)
			try insert("c", "No trigger", ["destinations": [["type": "dashboard", "variant": "runner"]], "triggers": []])
			try insert("d", "Builtin", runner, builtin: true)
			try db.execute(sql: "INSERT INTO flow_runs (id, flow_name, status, definition_snapshot_json, started_at, completed_at) VALUES ('r1', 'a', 'success', '{}', '2026-01-01', '2026-01-02')")
		}
		let blocks = try database.writer.read { db in try FlowDocuments.dashboardBlocks(db) }["blocks"]?.arrayValue ?? []
		#expect(blocks.compactMap { $0["id"]?.stringValue } == ["a", "b"])
		#expect(blocks[0]["lastRanAt"] == "2026-01-02")
		#expect(blocks[0]["showsResultSheet"] == true)
		#expect(blocks[0]["dashboardColor"] == "blue")
		#expect(blocks[1]["lastRanAt"] == .null)
	}
}
