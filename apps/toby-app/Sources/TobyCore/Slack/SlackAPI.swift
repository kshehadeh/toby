import Foundation
import TobyAI
import TobyStore

/// Slack credentials, stored as `slack.*` secrets (the legacy importer's names).
public struct SlackAccount: Sendable, Equatable {
	public static let fields = [
		"authMethod", "clientId", "clientSecret", "redirectUri", "botToken", "appToken", "botUserId", "oauthBotToken",
		"oauthUserToken", "oauthUserRefreshToken", "oauthBotRefreshToken", "oauthExpiresAt", "teamId", "teamName", "inboundEnabled",
	]

	public var values: [String: String]

	public init(_ values: [String: String]) {
		self.values = values.compactMapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty }
	}

	public subscript(_ field: String) -> String? { values[field] }

	/// `oauth` or `bot_token` (bot token present without an explicit method → bot_token).
	public var authMethod: String {
		if let method = values["authMethod"], method == "oauth" || method == "bot_token" { return method }
		return values["botToken"] != nil ? "bot_token" : "oauth"
	}

	public var hasAccessToken: Bool { values["botToken"] != nil || values["oauthBotToken"] != nil || values["oauthUserToken"] != nil }

	/// The default API token (user token first under OAuth).
	public func defaultToken() throws -> String {
		let token = authMethod == "bot_token" ? values["botToken"] : (values["oauthUserToken"] ?? values["oauthBotToken"] ?? values["botToken"])
		guard let token else {
			throw SlackError.notConfigured(authMethod == "bot_token" ? "Slack bot token not found." : "Slack is not connected. Sign in to Slack in Settings.")
		}
		return token
	}

	/// Token for posting (bot when available, so replies come from Toby).
	public func postToken() throws -> String { try values["botToken"] ?? values["oauthBotToken"] ?? defaultToken() }

	public var accessTokenIsFresh: Bool {
		guard let raw = values["oauthExpiresAt"], let expires = TodoRecurrence.parseISO(raw) else { return true }
		return expires.timeIntervalSinceNow > 60
	}

	/// Bot + app tokens for Socket Mode.
	public func inboundCredentials() throws -> (botToken: String, appToken: String, botUserID: String?) {
		guard let bot = values["botToken"] ?? values["oauthBotToken"] else {
			throw SlackError.notConfigured("Slack replies need a bot token (xoxb-...) and an app token (xapp-...) for Socket Mode.")
		}
		guard let app = values["appToken"] else {
			throw SlackError.notConfigured("Slack replies need an app-level token (xapp-...) with connections:write for Socket Mode.")
		}
		return (bot, app, values["botUserId"])
	}
}

public enum SlackError: Error, Equatable, LocalizedError, Sendable {
	case notConfigured(String)
	case api(String)

	public var errorDescription: String? {
		switch self {
		case let .notConfigured(message), let .api(message): message
		}
	}
}

/// Slack Web API calls with OAuth refresh (port of the plugin's `client.ts` / `tokens.ts`).
public struct SlackAPI: Sendable {
	static let expiredErrors: Set<String> = ["token_expired", "invalid_auth", "account_inactive"]

	let secrets: any SecretStore
	let transport: any HTTPTransport
	let refreshLock = RefreshLock()

	public init(secrets: any SecretStore, transport: any HTTPTransport = URLSessionTransport()) {
		self.secrets = secrets
		self.transport = transport
	}

	public func account() -> SlackAccount {
		var values: [String: String] = [:]
		for field in SlackAccount.fields { values[field] = (try? secrets.secret("slack.\(field)")) ?? nil }
		return SlackAccount(values)
	}

	public func save(_ patch: [String: String]) throws {
		for (field, value) in patch {
			if value.isEmpty { try secrets.removeSecret("slack.\(field)") } else { try secrets.setSecret(value, for: "slack.\(field)") }
		}
	}

	static func form(_ params: [String: String]) -> Data {
		var allowed = CharacterSet.alphanumerics
		allowed.insert(charactersIn: "-._~")
		return Data(params.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }.joined(separator: "&").utf8)
	}

	func post(_ method: String, _ params: [String: String], token: String?) async throws -> JSONValue {
		var request = URLRequest(url: URL(string: "https://slack.com/api/\(method)")!)
		request.httpMethod = "POST"
		request.timeoutInterval = 30
		request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
		if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
		request.httpBody = Self.form(params)
		let (data, response) = try await transport.send(request)
		guard (200 ..< 300).contains(response.statusCode) else {
			throw SlackError.api("Slack API \(method) failed (\(response.statusCode)): \(String(decoding: data.prefix(300), as: UTF8.self))")
		}
		return try JSONDecoder().decode(JSONValue.self, from: data)
	}

	/// Raw result (`ok` may be false). `token` overrides the default; OAuth
	/// tokens refresh when expired or rejected.
	public func result(_ method: String, _ params: [String: String] = [:], token explicit: String? = nil) async throws -> JSONValue {
		var account = account()
		var token = try explicit ?? account.defaultToken()
		if explicit == nil, account.authMethod == "oauth", !account.accessTokenIsFresh {
			token = try await refresh()
			account = self.account()
		}
		var json = try await post(method, params, token: token)
		if json["ok"] != true, explicit == nil, Self.expiredErrors.contains(json["error"]?.stringValue ?? ""), account.authMethod == "oauth" {
			json = try await post(method, params, token: try await refresh())
		}
		return json
	}

	/// Like `result`, but throws on `ok: false`.
	@discardableResult
	public func call(_ method: String, _ params: [String: String] = [:], token: String? = nil) async throws -> JSONValue {
		let json = try await result(method, params, token: token)
		guard json["ok"] == true else { throw SlackError.api("Slack API \(method) error: \(json["error"]?.stringValue ?? "unknown")") }
		return json
	}

	/// Refresh the OAuth access token and persist the rotated tokens.
	public func refresh() async throws -> String {
		try await refreshLock.run {
			let account = account()
			guard account.authMethod == "oauth" else { throw SlackError.notConfigured("Slack bot tokens can't be refreshed automatically.") }
			guard let clientID = account["clientId"] else { throw SlackError.notConfigured("Slack OAuth client ID is missing.") }
			guard let refreshToken = account["oauthUserRefreshToken"] ?? account["oauthBotRefreshToken"] else {
				throw SlackError.notConfigured("Slack OAuth refresh token is missing. Sign in to Slack again.")
			}
			let user = account["oauthUserRefreshToken"] != nil
			let json = try await post("oauth.v2.access", ["client_id": clientID, "grant_type": "refresh_token", "refresh_token": refreshToken], token: nil)
			guard json["ok"] == true else { throw SlackError.api("Slack OAuth refresh failed: \(json["error"]?.stringValue ?? "unknown")") }
			let userToken = json["authed_user"]?["access_token"]?.stringValue
			let botToken = json["access_token"]?.stringValue
			guard let access = user ? (userToken ?? botToken) : (botToken ?? userToken) else { throw SlackError.api("Slack OAuth refresh response missing access token.") }
			let nextRefresh = json["authed_user"]?["refresh_token"]?.stringValue ?? json["refresh_token"]?.stringValue ?? refreshToken
			let expiresIn = user ? (json["authed_user"]?["expires_in"] ?? json["expires_in"]) : (json["expires_in"] ?? json["authed_user"]?["expires_in"])
			var patch = [user ? "oauthUserToken" : "oauthBotToken": access, user ? "oauthUserRefreshToken" : "oauthBotRefreshToken": nextRefresh]
			patch["oauthExpiresAt"] = expiresIn?.doubleValue.map { TodoRecurrence.isoString(Date().addingTimeInterval(max(60, $0))) } ?? ""
			try save(patch)
			return access
		}
	}
}

/// Serializes token refreshes so concurrent calls share one rotation.
actor RefreshLock {
	var pending: Task<String, Error>?

	func run(_ body: @escaping @Sendable () async throws -> String) async throws -> String {
		if let pending { return try await pending.value }
		let task = Task { try await body() }
		pending = task
		defer { pending = nil }
		return try await task.value
	}
}

// MARK: Formatting (port of `slack-markdown.ts`, `mentions.ts`)

public enum SlackText {
	/// Best-effort GFM → Slack mrkdwn.
	public static func mrkdwn(_ text: String) -> String {
		var s = text.replacing(/\[([^\]]+)\]\(([^)]+)\)/) { "<\($0.2)|\($0.1)>" }
		s = s.replacing(/\*\*(.+?)\*\*/) { "*\($0.1)*" }
		s = s.replacing(/__(.+?)__/) { "*\($0.1)*" }
		s = s.replacing(/(?m)^#{1,6}\s+(.+)$/) { "*\($0.1)*" }
		return s.replacing(/~~(.+?)~~/) { "~\($0.1)~" }
	}

	public static func plain(_ text: String) -> String {
		var s = text.replacing(/\[([^\]]+)\]\([^)]+\)/) { String($0.1) }
		s = s.replacing(/\*\*(.+?)\*\*/) { String($0.1) }
		s = s.replacing(/__(.+?)__/) { String($0.1) }
		s = s.replacing(/(?m)^#{1,6}\s+/, with: "")
		s = s.replacing(/`([^`]+)`/) { String($0.1) }
		return s.replacing(/~~(.+?)~~/) { String($0.1) }
	}

	public static func chunks(_ text: String, max: Int) -> [String] {
		var out: [String] = []
		var rest = Substring(text)
		while !rest.isEmpty {
			if rest.count <= max { out.append(String(rest)); break }
			let window = rest.prefix(max)
			var split = window.lastIndex(of: "\n").map { rest.distance(from: rest.startIndex, to: $0) } ?? 0
			if Double(split) < Double(max) * 0.5 { split = max }
			let cut = rest.index(rest.startIndex, offsetBy: split)
			out.append(String(rest[..<cut]))
			rest = rest[cut...].drop { $0.isWhitespace }
		}
		return out
	}

	public static func sectionBlocks(_ text: String) -> String {
		JSONValue.array(chunks(mrkdwn(text), max: 3000).map { ["type": "section", "text": ["type": "mrkdwn", "text": .string($0)]] }).jsonString()
	}

	public static func contextBlocks(_ line: String) -> String {
		JSONValue.array([["type": "context", "elements": [["type": "mrkdwn", "text": .string(String(line.prefix(3000)))]]]]).jsonString()
	}

	/// Mentions/links → readable text (`@you` for the user).
	public static func clean(_ text: String, selfID: String) -> String {
		var s = text.replacing(/<@([A-Z0-9]+)(?:\|([^>]+))?>/) { $0.1 == selfID ? "@you" : "@\($0.2.map(String.init) ?? "someone")" }
		s = s.replacing(/<#[A-Z0-9]+\|([^>]+)>/) { "#\($0.1)" }
		s = s.replacing(/<(https?:[^|>]+)\|([^>]+)>/) { String($0.2) }
		s = s.replacing(/<(https?:[^>]+)>/) { String($0.1) }
		s = s.replacing(/<!(here|channel|everyone)>/) { "@\($0.1)" }
		return s.replacing(/\s+/, with: " ").trimmingCharacters(in: .whitespaces)
	}

	public static func isoTimestamp(_ ts: String) -> String? {
		Double(ts).map { TodoRecurrence.isoString(Date(timeIntervalSince1970: $0)) }
	}

	static func truncate(_ text: String, _ max: Int) -> String {
		text.count > max ? String(text.prefix(max - 1)).trimmingCharacters(in: .whitespaces) + "…" : text
	}
}
