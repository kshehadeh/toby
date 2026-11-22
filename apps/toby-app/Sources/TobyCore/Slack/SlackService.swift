import Foundation
import TobyAI

/// Slack as a built-in source: mentions/DMs for The Feed, chat tools, and
/// posting for the inbound bridge (port of the Slack plugin).
public struct SlackService: Sendable {
	public let api: SlackAPI

	public init(api: SlackAPI) { self.api = api }

	public var isConfigured: Bool { api.account().hasAccessToken }

	// MARK: Directory

	public struct Conversation: Sendable, Equatable {
		public var id: String
		public var name: String
		public var kind: String
		public var isPrivate: Bool
		public var isMember: Bool
		var json: JSONValue { ["id": .string(id), "name": .string(name), "kind": .string(kind), "isPrivate": .bool(isPrivate), "isMember": .bool(isMember)] }
	}

	public struct User: Sendable, Equatable {
		public var id: String
		public var name: String
		public var realName: String
		public var displayName: String?
		public var email: String?
		public var isBot: Bool

		init?(_ member: JSONValue) {
			guard let id = member["id"]?.stringValue, member["deleted"] != true else { return nil }
			self.id = id
			name = member["name"]?.stringValue?.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? id
			realName = member["real_name"]?.stringValue?.trimmingCharacters(in: .whitespaces).nilIfEmpty
				?? member["profile"]?["real_name"]?.stringValue?.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? name
			displayName = member["profile"]?["display_name"]?.stringValue?.trimmingCharacters(in: .whitespaces).nilIfEmpty
			email = member["profile"]?["email"]?.stringValue?.trimmingCharacters(in: .whitespaces).nilIfEmpty
			isBot = member["is_bot"] == true
		}

		func matches(_ query: String) -> Bool {
			query.isEmpty || [name, realName, displayName, email, id].compactMap { $0 }.joined(separator: " ").lowercased().contains(query)
		}

		var json: JSONValue {
			var out: [String: JSONValue] = ["id": .string(id), "name": .string(name), "realName": .string(realName), "isBot": .bool(isBot)]
			if let displayName { out["displayName"] = .string(displayName) }
			if let email { out["email"] = .string(email) }
			return .object(out)
		}
	}

	public func conversations(limit: Int = 200) async throws -> [Conversation] {
		let json = try await api.call("conversations.list", ["types": "public_channel,private_channel,mpim,im", "exclude_archived": "true", "limit": "\(limit)"])
		return (json["channels"]?.arrayValue ?? []).compactMap { channel in
			guard let id = channel["id"]?.stringValue else { return nil }
			let kind = channel["is_im"] == true ? "im" : channel["is_mpim"] == true ? "mpim" : channel["is_private"] == true ? "group" : "channel"
			let name = channel["name"]?.stringValue?.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? (kind == "im" ? "dm:\(channel["user"]?.stringValue ?? id)" : id)
			return Conversation(id: id, name: name, kind: kind, isPrivate: channel["is_private"] == true, isMember: channel["is_member"] == true)
		}
	}

	public func users(limit: Int = 200, paginate: Bool = false) async throws -> [User] {
		var users: [User] = []
		var cursor: String?
		repeat {
			var params = ["limit": "\(min(200, limit - users.count))"]
			if let cursor { params["cursor"] = cursor }
			let json = try await api.call("users.list", params)
			for member in json["members"]?.arrayValue ?? [] {
				if let user = User(member) { users.append(user) }
				if users.count >= limit { break }
			}
			cursor = json["response_metadata"]?["next_cursor"]?.stringValue?.nilIfEmpty
		} while paginate && cursor != nil && users.count < limit
		return users
	}

	public func searchUsers(_ query: String, limit: Int = 20) async throws -> JSONValue {
		let q = query.trimmingCharacters(in: .whitespaces)
		var found: [User] = []
		var emailLookup: JSONValue?
		if q.wholeMatch(of: /[^\s@]+@[^\s@]+\.[^\s@]+/) != nil {
			let json = try await api.result("users.lookupByEmail", ["email": q])
			if json["ok"] == true, let user = json["user"].flatMap(User.init), !user.isBot {
				found.append(user)
				emailLookup = ["attempted": true, "found": true]
			} else {
				var lookup: [String: JSONValue] = ["attempted": true, "found": false]
				if let error = json["error"]?.stringValue, error != "users_not_found" { lookup["error"] = .string("Slack API users.lookupByEmail error: \(error)") }
				emailLookup = .object(lookup)
			}
		}
		let roster = try await users(limit: q.isEmpty ? min(limit, 200) : 1000, paginate: !q.isEmpty)
		for user in roster where !user.isBot && user.matches(q.lowercased()) && !found.contains(where: { $0.id == user.id }) {
			found.append(user)
			if found.count >= limit { break }
		}
		var result: [String: JSONValue] = ["users": .array(found.prefix(limit).map(\.json))]
		if let emailLookup { result["emailLookup"] = emailLookup }
		return .object(result)
	}

	public func searchConversations(_ query: String, limit: Int = 30) async throws -> JSONValue {
		let q = query.trimmingCharacters(in: .whitespaces).lowercased()
		async let channels = conversations(limit: 500)
		async let people = users(limit: 500)
		let channelMatches = try await channels.filter { q.isEmpty || $0.name.lowercased().contains(q) || $0.id.lowercased().contains(q) }.prefix(limit)
		let userMatches = try await people.filter { !$0.isBot && $0.matches(q) }.prefix(limit)
		return ["channels": .array(channelMatches.map(\.json)), "users": .array(userMatches.map(\.json))]
	}

	/// Channel name/#name/ID, or a user (opens a DM).
	public func resolveChannel(_ target: String) async throws -> String {
		let value = target.trimmingCharacters(in: .whitespaces)
		guard !value.isEmpty else { throw SlackError.api("Channel or user target is required.") }
		if value.wholeMatch(of: /(?i)[CGD][A-Z0-9]+/) != nil { return value }
		let normalized = (value.hasPrefix("#") ? String(value.dropFirst()) : value).lowercased()
		if let channel = try await conversations(limit: 500).first(where: { $0.name.lowercased() == normalized }) { return channel.id }
		let people = try await users(limit: 500)
		let user = people.first { $0.name.lowercased() == normalized } ?? people.first { $0.realName.lowercased() == normalized }
			?? people.first { $0.displayName?.lowercased() == normalized } ?? people.first { $0.email?.lowercased() == normalized }
		guard let user else { throw SlackError.api("Could not resolve Slack channel or user \"\(target)\". Use searchChannels first or pass a channel ID.") }
		guard let id = try await api.call("conversations.open", ["users": user.id])["channel"]?["id"]?.stringValue else {
			throw SlackError.api("Could not open DM with user \"\(user.name)\".")
		}
		return id
	}

	// MARK: Messages

	/// Post markdown as mrkdwn blocks (falling back to `markdown_text`).
	public func post(channel: String, text: String, threadTS: String? = nil, token: String? = nil) async throws -> (channel: String, ts: String) {
		let channelID = try await resolveChannel(channel)
		let postToken = try token ?? api.account().postToken()
		var params = ["channel": channelID, "text": String(SlackText.plain(text).prefix(4000)), "blocks": SlackText.sectionBlocks(text)]
		if let threadTS { params["thread_ts"] = threadTS }
		let json = try await api.result("chat.postMessage", params, token: postToken)
		if json["ok"] == true, let ts = json["ts"]?.stringValue { return (json["channel"]?.stringValue ?? channelID, ts) }
		var fallback = ["channel": channelID, "markdown_text": String(SlackText.mrkdwn(text).prefix(12000))]
		if let threadTS { fallback["thread_ts"] = threadTS }
		let retry = try await api.result("chat.postMessage", fallback, token: postToken)
		guard retry["ok"] == true, let ts = retry["ts"]?.stringValue else {
			throw SlackError.api("Slack chat.postMessage error: \(json["error"]?.stringValue ?? "unknown") (markdown_text fallback failed: \(retry["error"]?.stringValue ?? "unknown"))")
		}
		return (retry["channel"]?.stringValue ?? channelID, ts)
	}

	static func statusPlain(_ line: String) -> String {
		line.replacingOccurrences(of: "\\_", with: "_").replacingOccurrences(of: "_", with: "").replacingOccurrences(of: "&amp;", with: "&")
			.replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">").trimmingCharacters(in: .whitespaces)
	}

	func postStatus(channel: String, line: String, threadTS: String?, token: String) async throws -> (channel: String, ts: String) {
		var params = ["channel": channel, "text": Self.statusPlain(line), "blocks": SlackText.contextBlocks(line)]
		if let threadTS { params["thread_ts"] = threadTS }
		let json = try await api.call("chat.postMessage", params, token: token)
		guard let ts = json["ts"]?.stringValue else { throw SlackError.api("Slack chat.postMessage did not return a message timestamp.") }
		return (json["channel"]?.stringValue ?? channel, ts)
	}

	func updateStatus(channel: String, ts: String, line: String, token: String) async throws {
		try await api.call("chat.update", ["channel": channel, "ts": ts, "text": Self.statusPlain(line), "blocks": SlackText.contextBlocks(line)], token: token)
	}

	func delete(channel: String, ts: String, token: String) async throws {
		try await api.call("chat.delete", ["channel": channel, "ts": ts], token: token)
	}

	public struct SearchHit: Sendable, Equatable {
		public var channelID: String
		public var channelName: String?
		public var ts: String
		public var threadTS: String?
		public var text: String
		public var user: String?
		public var username: String?
		public var permalink: String?
		public var isDirect: Bool

		var json: JSONValue {
			var out: [String: JSONValue] = ["channelId": .string(channelID), "ts": .string(ts), "text": .string(text)]
			if let channelName { out["channelName"] = .string(channelName) }
			if let threadTS { out["threadTs"] = .string(threadTS) }
			if let user { out["user"] = .string(user) }
			if let username { out["username"] = .string(username) }
			if let permalink { out["permalink"] = .string(permalink) }
			if isDirect { out["isDirect"] = true }
			return .object(out)
		}
	}

	/// `search.messages` (user token), newest first, paged up to `limit`.
	public func searchMessages(_ query: String, limit: Int = 20) async throws -> [SearchHit] {
		let account = api.account()
		let token = account.authMethod == "oauth" ? nil : (account["oauthUserToken"] ?? account["botToken"])
		let cap = max(1, min(1000, limit))
		var hits: [SearchHit] = []
		var page = 1
		while hits.count < cap {
			let json = try await api.call("search.messages", ["query": query, "count": "\(min(100, cap))", "page": "\(page)", "sort": "timestamp", "sort_dir": "desc"], token: token)
			let matches = json["messages"]?["matches"]?.arrayValue ?? []
			hits += matches.compactMap { match in
				guard let ts = match["ts"]?.stringValue else { return nil }
				let channel = match["channel"]
				return SearchHit(
					channelID: channel?["id"]?.stringValue ?? "", channelName: channel?["name"]?.stringValue, ts: ts, threadTS: match["thread_ts"]?.stringValue,
					text: (match["text"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines), user: match["user"]?.stringValue,
					username: match["username"]?.stringValue?.nilIfEmpty, permalink: match["permalink"]?.stringValue,
					isDirect: channel?["is_im"] == true || channel?["is_mpim"] == true,
				)
			}
			if matches.isEmpty || page >= (json["messages"]?["paging"]?["pages"]?.intValue ?? 1) { break }
			page += 1
		}
		return Array(hits.prefix(cap))
	}

	/// The user's id (OAuth user token only; search needs it).
	public func searchUserID() async throws -> String? {
		let account = api.account()
		guard account.authMethod == "oauth", account["oauthUserToken"] != nil else { return nil }
		return try await api.call("auth.test")["user_id"]?.stringValue
	}

	/// Recent mentions and DMs (last two days) in the dashboard summary shape.
	public func mentionsSummary(limit rawLimit: Int = 20, now: Date = Date()) async throws -> JSONValue {
		let limit = max(1, min(50, rawLimit))
		guard let selfID = try await searchUserID() else { throw SlackError.notConfigured("Slack mentions need a user token. Sign in to Slack again.") }
		var components = Calendar.current.dateComponents([.year, .month, .day], from: now)
		components.day = (components.day ?? 1) - 3
		let after = Calendar.current.date(from: components).map { FeedText.localDateKey($0) } ?? ""
		async let mentions = Result { try await searchMessages("<@\(selfID)> after:\(after)", limit: limit) }
		async let direct = Result { try await searchMessages("is:dm after:\(after)", limit: limit) }
		let results = await [mentions, direct]
		let hits = results.flatMap { (try? $0.get()) ?? [] }
		if hits.isEmpty, case let .failure(error)? = results.first(where: { if case .failure = $0 { true } else { false } }) { throw error }
		return Self.summary(hits, selfID: selfID, limit: limit, now: now)
	}

	static func summary(_ hits: [SearchHit], selfID: String, limit: Int, now: Date) -> JSONValue {
		var seen = Set<String>()
		var items: [JSONValue] = []
		for hit in hits.sorted(by: { (Double($0.ts) ?? 0) > (Double($1.ts) ?? 0) }) {
			guard !hit.channelID.isEmpty, hit.user != selfID else { continue }
			let id = "\(hit.channelID):\(hit.ts)"
			guard seen.insert(id).inserted else { continue }
			let text = SlackText.clean(hit.text, selfID: selfID)
			guard !text.isEmpty else { continue }
			let where_ = hit.isDirect ? "Direct message" : hit.channelName.map { "#\($0)" } ?? "Slack"
			var item: [String: JSONValue] = [
				"id": .string(id), "title": .string(SlackText.truncate(text, 160)), "subtitle": .string("\(hit.username.map { "@\($0)" } ?? "someone") · \(where_)"),
				"groupId": .string(hit.isDirect ? "direct" : "mentions"),
			]
			if text.count > 160 { item["detail"] = .string(SlackText.truncate(text, 600)) }
			if let timestamp = SlackText.isoTimestamp(hit.ts) { item["timestamp"] = .string(timestamp) }
			if let permalink = hit.permalink { item["url"] = .string(permalink) }
			items.append(.object(item))
			if items.count >= limit { break }
		}
		let direct = items.filter { $0["groupId"] == "direct" }.count
		return [
			"count": .number(Double(items.count)), "items": .array(items),
			"groups": [["id": "mentions", "label": "Mentions", "count": .number(Double(items.count - direct))], ["id": "direct", "label": "Direct messages", "count": .number(Double(direct))]],
			"generatedAt": .string(TodoRecurrence.isoString(now)),
		]
	}

	// MARK: Tools

	public func tools(dryRun: Bool) -> [ChatTool] {
		let service = self
		func tool(_ name: String, _ title: String, _ description: String, readOnly: Bool, _ properties: [(String, JSONValue)], required: [String], _ run: @escaping @Sendable (JSONValue) async throws -> JSONValue) -> ChatTool {
			ChatTool(tool: Tool(name: name, description: description, parameters: ToolSchema.object(properties, required: required), readOnly: readOnly) { args, _ in
				if dryRun, !readOnly { return ["dryRun": true, "message": .string("[DRY RUN] Would run \(title).")] }
				do { return try await run(ToolSchema.stripNulls(args)) } catch { return ["error": .string((error as? LocalizedError)?.errorDescription ?? "\(error)")] }
			}, title: title, readOnly: readOnly)
		}
		let channel: (String, JSONValue) = ("channel", ["type": "string", "description": "Channel name, #channel, channel ID, or username for DM"])
		let limit = { (text: String) -> (String, JSONValue) in ("limit", ["type": "number", "description": .string(text)]) }
		return [
			tool("postToChannel", "Post to channel", "Post a new message to a Slack channel, private channel, or DM. Pass channel name (e.g. general), #channel, channel ID, or a username for DMs.", readOnly: false,
			     [channel, ("text", ["type": "string", "description": "Message text to post"])], required: ["channel", "text"]) { args in
				let posted = try await service.post(channel: args["channel"]?.stringValue ?? "", text: args["text"]?.stringValue ?? "")
				return ["success": true, "channel": .string(posted.channel), "ts": .string(posted.ts)]
			},
			tool("replyToPost", "Reply to post", "Reply in a Slack thread. Requires the parent message timestamp (thread_ts) from the original post.", readOnly: false,
			     [channel, ("threadTs", ["type": "string", "description": "Parent message timestamp (thread_ts) to reply under"]), ("text", ["type": "string", "description": "Reply text"])],
			     required: ["channel", "threadTs", "text"]) { args in
				let posted = try await service.post(channel: args["channel"]?.stringValue ?? "", text: args["text"]?.stringValue ?? "", threadTS: args["threadTs"]?.stringValue)
				return ["success": true, "channel": .string(posted.channel), "ts": .string(posted.ts)]
			},
			tool("searchUsers", "Search users", "Search workspace members by display name, username, or email. Email lookup uses users.lookupByEmail (requires users:read.email).", readOnly: true,
			     [("query", ["type": "string", "description": "Name, username, partial match, or full email address to search for"]), limit("Maximum users to return (default 20)")], required: ["query"]) { args in
				try await service.searchUsers(args["query"]?.stringValue ?? "", limit: args["limit"]?.intValue ?? 20)
			},
			tool("searchChannels", "Search channels", "Search Slack channels (public, private the bot is in). For people, prefer searchUsers.", readOnly: true,
			     [("query", ["type": "string", "description": "Search text for channel/user names (empty returns a sample)"]), limit("Maximum matches per category (default 30)")], required: ["query"]) { args in
				try await service.searchConversations(args["query"]?.stringValue ?? "", limit: args["limit"]?.intValue ?? 30)
			},
			tool("searchMessages", "Search messages", "Search Slack message history across the workspace. Requires search scope on the connected token.", readOnly: true,
			     [("query", ["type": "string", "description": "Slack search query (supports Slack search syntax)"]), limit("Maximum messages to return (default 20)")], required: ["query"]) { args in
				let messages = try await service.searchMessages(args["query"]?.stringValue ?? "", limit: args["limit"]?.intValue ?? 20)
				return ["messages": .array(messages.map(\.json)), "count": .number(Double(messages.count))]
			},
			tool("getMentionsSummary", "Mentions and direct messages", "Recent messages that mention the user and direct messages to them (last two days), newest first, in the dashboard summary shape. Requires a user token.", readOnly: true,
			     [limit("Maximum messages to return (default 20, max 50)")], required: []) { args in
				try await service.mentionsSummary(limit: args["limit"]?.intValue ?? 20)
			},
		]
	}
}

/// The Feed's chat source: Slack mentions and DMs.
public struct SlackFeedSource: FeedSource {
	let slack: SlackService
	public init(slack: SlackService) { self.slack = slack }
	public var category: String { "chat" }
	public var providerName: String { "slack" }
	public var providerDisplayName: String { "Slack" }
	public var launchURL: String? { "slack://open" }
	public var itemActions: Set<String> { [] }

	public func summary(limit: Int) async throws -> JSONValue {
		guard slack.isConfigured else { throw SlackError.notConfigured("Slack isn't connected.") }
		return try await slack.mentionsSummary(limit: limit)
	}

	public func run(itemAction: String, itemID: String) async throws -> String { throw TodoError.invalid("Slack items have no actions.") }
}
