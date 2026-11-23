import Foundation
import GRDB
import TobyAI

/// A Socket Mode WebSocket.
public protocol SlackSocket: Sendable {
	func receive() async throws -> String
	func send(_ text: String) async throws
	func close() async
}

public struct URLSessionSlackSocket: SlackSocket {
	let task: URLSessionWebSocketTask

	public init(url: URL) {
		task = URLSession.shared.webSocketTask(with: url)
		task.resume()
	}

	public func receive() async throws -> String {
		switch try await task.receive() {
		case let .string(text): return text
		case let .data(data): return String(decoding: data, as: UTF8.self)
		@unknown default: return ""
		}
	}

	public func send(_ text: String) async throws { try await task.send(.string(text)) }
	public func close() async { task.cancel(with: .normalClosure, reason: nil) }
}

/// Slack DMs, mentions, and thread replies run headless chat turns and post
/// the reply back (port of the plugin's `inbound-*.ts` and core `chat-inbound`).
public actor SlackInbound {
	public struct Event: Sendable, Equatable {
		public var teamID: String
		public var channelID: String
		public var threadRootTS: String
		public var messageID: String
		public var text: String
		public var authorID: String
		public var isNewTurn: Bool

		public var externalKey: String { "slack:\(teamID):\(channelID):\(threadRootTS)" }
		public var isDM: Bool { SlackInbound.isDM(channelID) }
		public var label: String { isDM ? "DM" : "#\(channelID)" }
		public var replyThreadTS: String? { isDM && threadRootTS == channelID ? nil : threadRootTS }
		var metadata: JSONValue { ["teamId": .string(teamID), "channelId": .string(channelID), "threadRootTs": .string(threadRootTS), "channelLabel": .string(label)] }
	}

	public enum State: String, Sendable { case stopped, connecting, connected, reconnecting, error }

	let slack: SlackService
	let engine: ChatEngine
	let sessions: ChatSessionStore
	let writer: any DatabaseWriter
	let personaName: @Sendable () -> String?
	let openSocket: @Sendable (URL) -> any SlackSocket
	public private(set) var state: State = .stopped
	public private(set) var lastError: String?
	var botUserID = ""
	var knownSessions = Set<String>()
	var queues: [String: Task<Void, Never>] = [:]

	public init(
		slack: SlackService, engine: ChatEngine, sessions: ChatSessionStore, writer: any DatabaseWriter,
		personaName: @escaping @Sendable () -> String? = { nil },
		openSocket: @escaping @Sendable (URL) -> any SlackSocket = { URLSessionSlackSocket(url: $0) },
	) {
		self.slack = slack
		self.engine = engine
		self.sessions = sessions
		self.writer = writer
		self.personaName = personaName
		self.openSocket = openSocket
	}

	// MARK: Classification (port of `inbound-logic.ts`)

	public static func isDM(_ channelID: String) -> Bool { channelID.trimmingCharacters(in: .whitespaces).wholeMatch(of: /(?i)D[A-Z0-9]+/) != nil }

	static func threadRoot(channel: String, ts: String, threadTS: String?) -> String { isDM(channel) ? (threadTS ?? channel) : (threadTS ?? ts) }

	static func stripMention(_ text: String, bot: String) -> String {
		guard !bot.isEmpty else { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
		return text.replacingOccurrences(of: "<@\(bot)>", with: "", options: .caseInsensitive).trimmingCharacters(in: .whitespacesAndNewlines)
	}

	/// An `events_api` event → inbound event, or nil to ignore.
	func event(from payload: JSONValue) -> Event? {
		guard let event = payload["event"] else { return nil }
		let team = payload["team_id"]?.stringValue ?? event["team"]?.stringValue ?? "unknown"
		let channel = event["channel"]?.stringValue ?? ""
		let ts = event["ts"]?.stringValue ?? ""
		let threadTS = event["thread_ts"]?.stringValue?.nilIfEmpty
		let text = event["text"]?.stringValue ?? ""
		switch event["type"]?.stringValue {
		case "app_mention":
			let body = Self.stripMention(text, bot: botUserID)
			guard !body.isEmpty else { return nil }
			return Event(teamID: team, channelID: channel, threadRootTS: Self.threadRoot(channel: channel, ts: ts, threadTS: threadTS), messageID: ts, text: body,
			             authorID: event["user"]?.stringValue ?? "", isNewTurn: true)
		case "message":
			guard event["subtype"] == nil, let user = event["user"]?.stringValue, !user.isEmpty, user != botUserID,
			      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
			let dm = Self.isDM(channel)
			guard dm || threadTS != nil else { return nil }
			let root = Self.threadRoot(channel: channel, ts: ts, threadTS: threadTS)
			let key = "slack:\(team):\(channel):\(root)"
			let awaiting = (try? pendingAskUser(key)) != nil
			// Channel threads only continue conversations Toby is already in.
			if !dm, !knownSessions.contains(key) { return nil }
			let body = dm ? Self.stripMention(text, bot: botUserID) : text.trimmingCharacters(in: .whitespacesAndNewlines)
			guard !body.isEmpty else { return nil }
			return Event(teamID: team, channelID: channel, threadRootTS: root, messageID: ts, text: body, authorID: user, isNewTurn: !awaiting)
		default:
			return nil
		}
	}

	// MARK: External sessions (`chat_external_sessions`)

	func pendingAskUser(_ key: String) throws -> JSONValue? {
		try writer.read { db in
			try String.fetchOne(db, sql: "SELECT awaiting_ask_user_json FROM chat_external_sessions WHERE integration = 'slack' AND external_key = ?", arguments: [key])
		}.flatMap { try? JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) }
	}

	func lastProcessed(_ key: String) throws -> String? {
		try writer.read { db in
			try String.fetchOne(db, sql: "SELECT last_processed_message_id FROM chat_external_sessions WHERE integration = 'slack' AND external_key = ?", arguments: [key])
		}
	}

	func setStatus(_ key: String, _ status: String, pending: JSONValue?? = nil) throws {
		let now = TodoRecurrence.isoString(Date())
		try writer.write { db in
			var sql = "UPDATE chat_external_sessions SET lifecycle_status = ?, updated_at = ?"
			var args: [any DatabaseValueConvertible] = [status, now]
			if status == "running" { sql += ", active_since = ?"; args.append(now) }
			if status == "idle" { sql += ", active_since = NULL, ended_at = ?"; args.append(now) }
			if let pending { sql += ", awaiting_ask_user_json = ?"; args.append(pending?.jsonString()) }
			try db.execute(sql: sql + " WHERE integration = 'slack' AND external_key = ?", arguments: StatementArguments(args + [key]))
		}
	}

	func markProcessed(_ key: String, _ messageID: String) throws {
		let now = TodoRecurrence.isoString(Date())
		try writer.write { db in
			try db.execute(sql: "UPDATE chat_external_sessions SET last_processed_message_id = ?, last_remote_message_at = ?, updated_at = ? WHERE integration = 'slack' AND external_key = ?",
			               arguments: [messageID, now, now, key])
		}
	}

	/// The chat session for a conversation, recreated if the user deleted it.
	func sessionID(for event: Event) throws -> String {
		let key = event.externalKey
		let existing: String? = try writer.read { db in
			try String.fetchOne(db, sql: """
			SELECT es.session_id FROM chat_external_sessions es JOIN chat_sessions s ON s.id = es.session_id
			WHERE es.integration = 'slack' AND es.external_key = ?
			""", arguments: [key])
		}
		if let existing { return existing }
		var settings: [String: JSONValue] = [:]
		if let persona = personaName() { settings["persona"] = .string(persona) }
		let name = "Slack \(event.label)"
		guard let id = try sessions.create(name: name, settings: settings.isEmpty ? nil : .object(settings))["id"]?.stringValue else { throw SlackError.api("Could not create a chat session.") }
		let now = TodoRecurrence.isoString(Date())
		try writer.write { db in
			try db.execute(sql: """
			INSERT INTO chat_external_sessions (integration, external_key, session_id, display_name, metadata_json, lifecycle_status, active_since, last_remote_message_at, created_at, updated_at)
			VALUES ('slack', ?, ?, ?, ?, 'running', ?, ?, ?, ?)
			ON CONFLICT(integration, external_key) DO UPDATE SET session_id = excluded.session_id, lifecycle_status = 'running', active_since = excluded.active_since, ended_at = NULL, updated_at = excluded.updated_at
			""", arguments: [key, id, name, event.metadata.jsonString(), now, now, now, now])
		}
		knownSessions.insert(key)
		return id
	}

	// MARK: Turns (port of `chat-inbound/router.ts`)

	/// Process an event after any earlier one for the same conversation.
	public func handle(_ event: Event) async {
		let key = event.externalKey
		let previous = queues[key]
		let task = Task { await previous?.value; await self.process(event) }
		queues[key] = task
		await task.value
		if queues[key] == task { queues[key] = nil }
	}

	func process(_ event: Event) async {
		guard event.authorID != botUserID, (try? lastProcessed(event.externalKey)) != event.messageID else { return }
		let pending = try? pendingAskUser(event.externalKey)
		if pending != nil, !event.isNewTurn {
			// A reply to Toby's question continues the conversation.
			try? setStatus(event.externalKey, "idle", pending: .some(nil))
		} else if !event.isNewTurn {
			return
		}
		guard (try? sessionID(for: event)) != nil else { return }
		try? markProcessed(event.externalKey, event.messageID)
		await runTurn(event, text: event.text)
	}

	func runTurn(_ event: Event, text: String) async {
		let key = event.externalKey
		let token: String
		do { token = try slack.api.account().postToken() } catch { return }
		let reporter = SlackStatusReporter(slack: slack, channel: event.channelID, threadTS: event.replyThreadTS, token: token)
		let posted = PostedFlag()
		do {
			let sessionID = try sessionID(for: event)
			try setStatus(key, "running")
			let appendix = """
			You are in Slack \(event.isDM ? "DM" : "channel `\(event.channelID)`, thread `\(event.threadRootTS)`").
			Your main assistant reply is posted automatically. Use **replyToPost** only for an extra follow-up message (not as a substitute for your normal reply).
			"""
			let slack = slack
			let writer = writer
			let done = try await engine.runTurn(sessionID: sessionID, text: text, instructionsAppendix: appendix, onEvent: { chatEvent in
				if chatEvent["type"] == "tool_call_complete", ["postToChannel", "replyToPost"].contains(chatEvent["toolName"]?.stringValue ?? ""), chatEvent["result"]?["success"] == true { posted.set() }
				if let line = SlackStatusReporter.line(for: chatEvent) { Task { await reporter.update(line) } }
			}, askUser: { _, query, options in
				let pending: JSONValue = ["question": .string(query), "options": .array(options.map(JSONValue.string)), "createdAt": .string(TodoRecurrence.isoString(Date()))]
				try await writer.write { db in
					try db.execute(sql: "UPDATE chat_external_sessions SET awaiting_ask_user_json = ?, lifecycle_status = 'awaiting_user', updated_at = ? WHERE integration = 'slack' AND external_key = ?",
					               arguments: [pending.jsonString(), TodoRecurrence.isoString(Date()), key])
				}
				let lines = options.enumerated().map { "\($0.offset + 1)) \($0.element)" }.joined(separator: "\n")
				_ = try await slack.post(channel: event.channelID, text: "\(query)\n\n\(lines)\n\n_Reply with a number, option text, or your answer._", threadTS: event.replyThreadTS, token: token)
				throw SlackError.api("Question posted to user. Stop responding and wait for their reply — it will arrive as a new message.")
			})
			await reporter.clear()
			let reply = done["text"]?.stringValue ?? ""
			if !reply.isEmpty, !posted.value { _ = try await slack.post(channel: event.channelID, text: reply, threadTS: event.replyThreadTS, token: token) }
		} catch {
			await reporter.clear()
			lastError = (error as? LocalizedError)?.errorDescription ?? "\(error)"
			try? setStatus(key, "error")
			_ = try? await slack.post(channel: event.channelID, text: "Sorry, I hit an error: \(lastError ?? "")", threadTS: event.replyThreadTS, token: token)
		}
		if (try? pendingAskUser(key)) == nil { try? setStatus(key, "idle") }
	}

	// MARK: Socket Mode

	/// Connect and process events until cancelled; reconnects with backoff.
	public func run() async {
		var delay: Duration = .seconds(2)
		while !Task.isCancelled {
			do {
				try await connectOnce()
				delay = .seconds(2)
			} catch is CancellationError {
				break
			} catch {
				lastError = (error as? LocalizedError)?.errorDescription ?? "\(error)"
				state = .error
				TobyLog.shared.warn("chat-inbound", "slack_socket_error", ["error": .string(lastError ?? "")])
			}
			state = .reconnecting
			try? await Task.sleep(for: delay)
			delay = min(delay * 2, .seconds(60))
		}
		state = .stopped
	}

	func connectOnce() async throws {
		state = .connecting
		let credentials = try slack.api.account().inboundCredentials()
		botUserID = try await slack.api.call("auth.test", token: credentials.botToken)["user_id"]?.stringValue ?? credentials.botUserID ?? ""
		knownSessions = Set(try await writer.read { db in try String.fetchAll(db, sql: "SELECT external_key FROM chat_external_sessions WHERE integration = 'slack'") })
		guard let raw = try await slack.api.call("apps.connections.open", token: credentials.appToken)["url"]?.stringValue, let url = URL(string: raw) else {
			throw SlackError.api("Slack Socket Mode didn't return a connection URL.")
		}
		let socket = openSocket(url)
		defer { Task { await socket.close() } }
		while !Task.isCancelled {
			let message = try await socket.receive()
			guard let envelope = try? JSONDecoder().decode(JSONValue.self, from: Data(message.utf8)) else { continue }
			if let id = envelope["envelope_id"]?.stringValue { try await socket.send(JSONValue.object(["envelope_id": .string(id)]).jsonString()) }
			switch envelope["type"]?.stringValue {
			case "hello": state = .connected
			case "disconnect": return
			case "events_api":
				if let payload = envelope["payload"], let event = event(from: payload) {
					if event.isNewTurn { knownSessions.insert(event.externalKey) }
					Task { await self.handle(event) }
				}
			default: break
			}
		}
	}
}

final class PostedFlag: @unchecked Sendable {
	private let lock = NSLock()
	private var flag = false
	func set() { lock.withLock { flag = true } }
	var value: Bool { lock.withLock { flag } }
}

/// One status message per turn, edited in place at most once a second and
/// deleted when the turn ends (port of `status-reporter.ts`).
actor SlackStatusReporter {
	let slack: SlackService
	let channel: String
	let threadTS: String?
	let token: String
	var message: (channel: String, ts: String)?
	var shown: String?
	var lastUpdate = ContinuousClock.now - .seconds(10)

	init(slack: SlackService, channel: String, threadTS: String?, token: String) {
		self.slack = slack
		self.channel = channel
		self.threadTS = threadTS
		self.token = token
	}

	func update(_ line: String) async {
		let trimmed = line.trimmingCharacters(in: .whitespaces)
		guard !trimmed.isEmpty, trimmed != shown, ContinuousClock.now - lastUpdate >= .seconds(1) || message == nil else { return }
		shown = trimmed
		lastUpdate = .now
		if let message {
			try? await slack.updateStatus(channel: message.channel, ts: message.ts, line: trimmed, token: token)
		} else {
			message = try? await slack.postStatus(channel: channel, line: trimmed, threadTS: threadTS, token: token)
		}
	}

	func clear() async {
		guard let message else { return }
		self.message = nil
		shown = nil
		try? await slack.delete(channel: message.channel, ts: message.ts, token: token)
	}

	static func escape(_ text: String) -> String {
		text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "_", with: "\\_")
	}

	static func emoji(tool: String) -> String {
		let lower = tool.lowercased()
		if tool == "askUser" { return "❓" }
		for (keys, emoji) in [(["email", "mail", "inbox"], "📧"), (["calendar", "event"], "📅"), (["task", "todo", "reminder"], "✅"), (["memory"], "🧠"),
		                      (["chat", "post", "reply", "channel"], "💬"), (["plan"], "📋"), (["search", "find"], "🔍"), (["user", "people", "contact"], "👤"),
		                      (["wifi", "network"], "📶"), (["skill"], "📚")] where keys.contains(where: lower.contains) { return emoji }
		return "🔧"
	}

	/// A mrkdwn progress line for a chat event, or nil.
	static func line(for event: JSONValue) -> String? {
		switch event["type"]?.stringValue {
		case "lifecycle_start":
			guard let header = event["header"]?.stringValue, !header.isEmpty else { return nil }
			let emoji = header.hasPrefix("Chatting with") || header.lowercased().contains("model") ? "🤖" : "⚙️"
			return "\(emoji) _\(escape(header))_"
		case "assistant_segment_start": return "💬 _Receiving response…_"
		case "tool_call_start":
			guard event["argsUpdate"] != true, let tool = event["toolName"]?.stringValue else { return nil }
			return "\(emoji(tool: tool)) _\(escape("Calling \(tool)…"))_"
		default: return nil
		}
	}
}
