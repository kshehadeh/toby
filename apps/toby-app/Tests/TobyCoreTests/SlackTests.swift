import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyStore

/// Fake Slack Web API: answers by method name and records form params.
final class FakeSlackAPI: HTTPTransport, @unchecked Sendable {
	let lock = NSLock()
	var handlers: [String: (_ params: [String: String], _ token: String?) -> JSONValue]
	private(set) var calls: [(method: String, params: [String: String], token: String?)] = []

	init(_ handlers: [String: (_ params: [String: String], _ token: String?) -> JSONValue]) { self.handlers = handlers }

	func calls(_ method: String) -> [[String: String]] { lock.withLock { calls.filter { $0.method == method }.map(\.params) } }

	func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
		let method = request.url!.lastPathComponent
		let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
		var params: [String: String] = [:]
		for pair in body.split(separator: "&") {
			let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
			params[parts[0]] = parts.count > 1 ? (parts[1].removingPercentEncoding ?? parts[1]) : ""
		}
		let token = request.value(forHTTPHeaderField: "Authorization")?.replacingOccurrences(of: "Bearer ", with: "")
		let reply: JSONValue = lock.withLock {
			calls.append((method, params, token))
			return handlers[method]?(params, token) ?? ["ok": false, "error": "unknown_method"]
		}
		return (Data(reply.jsonString().utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
	}

	func streamLines(_ request: URLRequest) async throws -> StreamedResponse {
		fatalError("Slack doesn't stream")
	}
}

/// Socket Mode frames from a script, then waits until closed.
actor FakeSlackSocket: SlackSocket {
	var frames: [String]
	private(set) var sent: [String] = []
	init(_ frames: [JSONValue]) { self.frames = frames.map { $0.jsonString() } }

	func receive() async throws -> String {
		if frames.isEmpty {
			try await Task.sleep(for: .seconds(30))
			throw CancellationError()
		}
		return frames.removeFirst()
	}

	func send(_ text: String) async throws { sent.append(text) }
	func close() async {}
}

@Suite("Slack")
struct SlackTests {
	static func secrets(_ values: [String: String]) -> InMemorySecretStore {
		InMemorySecretStore(Dictionary(uniqueKeysWithValues: values.map { ("slack.\($0.key)", $0.value) }))
	}

	@Test func refreshesExpiredOAuthTokensAndRetriesRejectedOnes() async throws {
		let secrets = Self.secrets(["authMethod": "oauth", "clientId": "cid", "oauthUserToken": "xoxp-old", "oauthUserRefreshToken": "r1", "oauthExpiresAt": "2020-01-01T00:00:00.000Z"])
		let fake = FakeSlackAPI([
			"oauth.v2.access": { params, _ in
				#expect(params["grant_type"] == "refresh_token")
				return ["ok": true, "authed_user": ["access_token": .string("xoxp-\(params["refresh_token"]!)"), "refresh_token": "r2", "expires_in": 43200]]
			},
			"auth.test": { _, token in token == "xoxp-r2" ? ["ok": true, "user_id": "U1"] : ["ok": false, "error": "invalid_auth"] },
		])
		let api = SlackAPI(secrets: secrets, transport: fake)
		#expect(try await api.call("auth.test")["user_id"] == "U1")
		#expect(try secrets.secret("slack.oauthUserToken") == "xoxp-r2")
		#expect(fake.calls("oauth.v2.access").map { $0["refresh_token"] } == ["r1", "r2"])
		#expect(try secrets.secret("slack.oauthUserRefreshToken") == "r2")
		#expect(api.account().accessTokenIsFresh)
		#expect(fake.calls("auth.test").count == 2, "rejected token triggers one refresh + retry")
	}

	@Test func mentionsSummaryDedupesCleansAndGroups() async throws {
		let hit: (String, String, String, Bool) -> JSONValue = { ts, user, text, dm in
			["ts": .string(ts), "user": .string(user), "username": "ana", "text": .string(text), "permalink": "https://x.slack.com/p",
			 "channel": ["id": dm ? "D1" : "C1", "name": dm ? "U9" : "eng", "is_im": .bool(dm)]]
		}
		let fake = FakeSlackAPI([
			"auth.test": { _, _ in ["ok": true, "user_id": "UME"] },
			"search.messages": { params, _ in
				params["query"]!.hasPrefix("<@UME>")
					? ["ok": true, "messages": ["matches": [hit("1700000002.1", "U2", "hey <@UME|me> see <https://a.b|the doc>", false), hit("1700000001.1", "UME", "mine", false)]]]
					: ["ok": true, "messages": ["matches": [hit("1700000003.1", "U2", "quick q?", true), hit("1700000002.1", "U2", "dup", false)]]]
			},
		])
		let slack = SlackService(api: SlackAPI(secrets: Self.secrets(["authMethod": "oauth", "oauthUserToken": "xoxp"]), transport: fake))
		let summary = try await slack.mentionsSummary()
		let items = summary["items"]?.arrayValue ?? []
		#expect(items.compactMap { $0["id"]?.stringValue } == ["D1:1700000003.1", "C1:1700000002.1"])
		#expect(items[0]["subtitle"] == "@ana · Direct message")
		#expect(items[1]["title"] == "hey @you see the doc")
		#expect(items[1]["subtitle"] == "@ana · #eng")
		#expect(summary["groups"]?[1]?["count"] == 1)
		#expect(fake.calls("search.messages").first?["query"]?.contains(" after:") == true)
	}

	@Test func postsBlocksThenFallsBackToMarkdownAndOpensDMs() async throws {
		let fake = FakeSlackAPI([
			"conversations.list": { _, _ in ["ok": true, "channels": [["id": "C9", "name": "general"]]] },
			"users.list": { _, _ in ["ok": true, "members": [["id": "U7", "name": "bo", "real_name": "Bo B"]]] },
			"conversations.open": { params, _ in ["ok": true, "channel": ["id": .string("D-\(params["users"]!)")]] },
			"chat.postMessage": { params, token in
				#expect(token == "xoxb")
				return params["blocks"] != nil ? ["ok": false, "error": "invalid_blocks"] : ["ok": true, "ts": "1.2", "channel": .string(params["channel"]!)]
			},
		])
		let slack = SlackService(api: SlackAPI(secrets: Self.secrets(["botToken": "xoxb"]), transport: fake))
		#expect(try await slack.resolveChannel("#general") == "C9")
		#expect(try await slack.resolveChannel("Bo B") == "D-U7")
		let posted = try await slack.post(channel: "general", text: "**Hi** [doc](https://d)")
		#expect(posted.ts == "1.2")
		let attempts = fake.calls("chat.postMessage")
		#expect(attempts[0]["text"] == "Hi doc")
		#expect(attempts[0]["blocks"]?.contains("*Hi* <https://d|doc>") == true)
		#expect(attempts[1]["markdown_text"] == "*Hi* <https://d|doc>")
	}

	@Test func toolsAreGatedByDryRun() async throws {
		let slack = SlackService(api: SlackAPI(secrets: Self.secrets(["botToken": "xoxb"]), transport: FakeSlackAPI([:])))
		let tools = Dictionary(uniqueKeysWithValues: slack.tools(dryRun: true).map { ($0.tool.name, $0.tool) })
		#expect(Set(tools.keys) == ["postToChannel", "replyToPost", "searchUsers", "searchChannels", "searchMessages", "getMentionsSummary"])
		#expect(try await tools["postToChannel"]!.execute(["channel": "x", "text": "y"], ToolContext(toolCallId: "c"))["dryRun"] == true)
	}

	@Test func inboundRepliesToADirectMessageOverSocketMode() async throws {
		let chat = try ChatFixture([ChatFixture.models, .sse([Chunks.text("Hi Ana!")] + Chunks.finish("stop"))])
		let fake = FakeSlackAPI([
			"auth.test": { _, token in ["ok": true, "user_id": .string(token == "xoxb" ? "UBOT" : "UME")] },
			"apps.connections.open": { _, token in
				#expect(token == "xapp")
				return ["ok": true, "url": "wss://example.invalid/socket"]
			},
			"chat.postMessage": { params, _ in ["ok": true, "ts": "9.9", "channel": .string(params["channel"] ?? "")] },
			"chat.update": { _, _ in ["ok": true] },
			"chat.delete": { _, _ in ["ok": true] },
		])
		let slack = SlackService(api: SlackAPI(secrets: Self.secrets(["botToken": "xoxb", "appToken": "xapp"]), transport: fake))
		let socket = FakeSlackSocket([
			["type": "hello"],
			["envelope_id": "e1", "type": "events_api", "payload": ["team_id": "T1", "event": ["type": "message", "channel": "D42", "user": "UANA", "text": "hello <@UBOT>", "ts": "100.1"]]],
			["envelope_id": "e2", "type": "events_api", "payload": ["team_id": "T1", "event": ["type": "message", "channel": "C5", "user": "UANA", "text": "stray thread", "ts": "101.1", "thread_ts": "50.0"]]],
			["envelope_id": "e3", "type": "events_api", "payload": ["team_id": "T1", "event": ["type": "message", "subtype": "bot_message", "channel": "D42", "text": "bot", "ts": "102.1"]]],
		])
		let inbound = SlackInbound(slack: slack, engine: chat.engine, sessions: chat.sessions, writer: chat.database.writer, personaName: { "Toby" }, openSocket: { _ in socket })
		let run = Task { await inbound.run() }
		defer { run.cancel() }
		for _ in 0 ..< 200 {
			if fake.calls("chat.postMessage").contains(where: { $0["text"] == "Hi Ana!" }) { break }
			try await Task.sleep(for: .milliseconds(20))
		}
		let replies = fake.calls("chat.postMessage").filter { $0["blocks"]?.contains("section") == true }
		#expect(replies.count == 1)
		#expect(replies.first?["channel"] == "D42")
		#expect(replies.first?["thread_ts"] == nil, "top-level DM replies stay top-level")
		#expect(await socket.sent.count == 3, "every envelope is acknowledged")
		#expect(await inbound.state == .connected)
		let stored = try chat.sessions.list(limit: 5)
		#expect(stored.first?["name"] == "Slack DM")
		#expect(chat.transport.requestBodies.contains { $0["messages"]?.arrayValue?.last?["content"]?.stringValue == "hello" })
		let lastProcessed = try await chat.database.writer.read { db in
			try String.fetchOne(db, sql: "SELECT last_processed_message_id FROM chat_external_sessions WHERE external_key = 'slack:T1:D42:D42'")
		}
		#expect(lastProcessed == "100.1")
	}

	@Test func askUserPostsTheQuestionAndTheReplyContinuesTheTurn() async throws {
		let chat = try ChatFixture([
			ChatFixture.models,
			.sse([Chunks.toolCall(index: 0, id: "c1", name: "askUser", arguments: #"{"query":"Which day?","options":["Mon","Tue"]}"#)] + Chunks.finish("tool_calls")),
			.sse([Chunks.text("Waiting for you.")] + Chunks.finish("stop")),
			.sse([Chunks.text("Tuesday it is.")] + Chunks.finish("stop")),
		])
		let fake = FakeSlackAPI([
			"chat.postMessage": { params, _ in ["ok": true, "ts": "9.9", "channel": .string(params["channel"] ?? "")] },
			"chat.update": { _, _ in ["ok": true] }, "chat.delete": { _, _ in ["ok": true] },
		])
		let slack = SlackService(api: SlackAPI(secrets: Self.secrets(["botToken": "xoxb", "appToken": "xapp"]), transport: fake))
		let inbound = SlackInbound(slack: slack, engine: chat.engine, sessions: chat.sessions, writer: chat.database.writer)
		let first = SlackInbound.Event(teamID: "T1", channelID: "D42", threadRootTS: "D42", messageID: "1.0", text: "book lunch", authorID: "UANA", isNewTurn: true)
		await inbound.handle(first)
		let texts = { fake.calls("chat.postMessage").compactMap { $0["text"] } }
		#expect(texts().contains { $0.hasPrefix("Which day?") && $0.contains("1) Mon\n2) Tue") })
		#expect(try await inbound.pendingAskUser(first.externalKey)?["question"] == "Which day?")
		let reply = SlackInbound.Event(teamID: "T1", channelID: "D42", threadRootTS: "D42", messageID: "2.0", text: "2", authorID: "UANA", isNewTurn: false)
		await inbound.handle(reply)
		#expect(try await inbound.pendingAskUser(first.externalKey) == nil)
		#expect(texts().contains("Tuesday it is."), "posted: \(texts())")
		await inbound.handle(reply)
		#expect(texts().filter { $0 == "Tuesday it is." }.count == 1, "duplicate deliveries are ignored")
	}
}
