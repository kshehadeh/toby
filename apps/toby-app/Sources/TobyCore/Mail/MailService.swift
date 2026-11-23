import Foundation
import GRDB
import TobyAI
import TobyMail
import TobyStore

/// The IMAP/SMTP account, stored as `mail.*` secrets (the same names the
/// legacy importer writes).
public struct MailAccount: Sendable, Equatable {
	public static let fields = ["imapHost", "imapPort", "imapSecure", "imapUsername", "imapPassword", "smtpHost", "smtpPort", "smtpSecure", "smtpUsername", "smtpPassword", "fromAddress", "fromName"]

	public var imap: MailServer
	public var smtp: MailServer?
	public var fromAddress: String
	public var fromName: String

	static func bool(_ raw: String?, _ fallback: Bool) -> Bool {
		switch raw?.trimmingCharacters(in: .whitespaces).lowercased() {
		case "true", "1", "yes": true
		case "false", "0", "no": false
		default: fallback
		}
	}

	static func port(_ raw: String?, _ fallback: Int) -> Int {
		guard let value = raw.flatMap({ Double($0.trimmingCharacters(in: .whitespaces)) }), value > 0, value.isFinite else { return fallback }
		return Int(value)
	}

	/// Parse raw fields; nil without IMAP host, username, and password.
	public init?(_ raw: [String: String]) {
		func value(_ key: String) -> String { (raw[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
		func host(_ key: String) -> String { MailServer.normalizeHost(value(key)) }
		guard !host("imapHost").isEmpty, !value("imapUsername").isEmpty, !value("imapPassword").isEmpty else { return nil }
		imap = MailServer(host: host("imapHost"), port: Self.port(raw["imapPort"], 993), secure: Self.bool(raw["imapSecure"], true), username: value("imapUsername"), password: value("imapPassword"))
		smtp = host("smtpHost").isEmpty || value("smtpUsername").isEmpty || value("smtpPassword").isEmpty ? nil
			: MailServer(host: host("smtpHost"), port: Self.port(raw["smtpPort"], 587), secure: Self.bool(raw["smtpSecure"], false), username: value("smtpUsername"), password: value("smtpPassword"))
		fromAddress = value("fromAddress")
		fromName = value("fromName")
	}

	/// The user's own addresses (for direct/awaiting-reply facts).
	var feedScope: String { FeedText.sha([imap.host.lowercased(), String(imap.port), imap.username].joined(separator: "\n")) }

	public var selfAddresses: [String] { [imap.username, fromAddress].filter { $0.contains("@") } }
}

/// Mail as a built-in source (port of the email plugin): a local cache of
/// message metadata, live unread summaries for The Feed, and chat tools.
public struct MailService: Sendable {
	public static let defaultMailbox = "INBOX"
	static let bulkHeaders = ["LIST-UNSUBSCRIBE", "LIST-ID", "PRECEDENCE", "AUTO-SUBMITTED", "X-AUTO-RESPONSE-SUPPRESS", "FEEDBACK-ID"]
	nonisolated(unsafe) static let automatedSender = /(?i)^(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|notifications?|alerts?|bounce[s]?)[@+._-]/

	let writer: any DatabaseWriter
	let secrets: any SecretStore
	let openStream: (@Sendable (String, Int, Bool) async throws -> any MailStream)?

	public init(writer: any DatabaseWriter, secrets: any SecretStore, openStream: (@Sendable (String, Int, Bool) async throws -> any MailStream)? = nil) {
		self.writer = writer
		self.secrets = secrets
		self.openStream = openStream
	}

	public func isBacked(by writer: any DatabaseWriter) -> Bool { self.writer === writer }

	// MARK: Account

	public func account() -> MailAccount? {
		var raw: [String: String] = [:]
		for field in MailAccount.fields { raw[field] = (try? secrets.secret("mail.\(field)")) ?? nil }
		return MailAccount(raw)
	}

	public var isConfigured: Bool { account() != nil }

	func requireAccount() throws -> MailAccount {
		guard let account = account() else { throw MailError.notConfigured("IMAP credentials not configured.") }
		return account
	}

	/// Verify IMAP login with these fields, then save them.
	public func connect(_ raw: [String: String]) async throws {
		guard let account = MailAccount(raw) else { throw MailError.notConfigured("Email requires IMAP credentials (host, port, username, password).") }
		let client = try await IMAPClient.connect(account.imap, open: openStream)
		await client.logout()
		var raw = raw
		raw["imapHost"] = account.imap.host
		if let smtpHost = raw["smtpHost"] { raw["smtpHost"] = MailServer.normalizeHost(smtpHost) }
		for field in MailAccount.fields {
			let value = (raw[field] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
			if value.isEmpty { try secrets.removeSecret("mail.\(field)") } else { try secrets.setSecret(value, for: "mail.\(field)") }
		}
	}

	public func disconnect() throws {
		for field in MailAccount.fields { try secrets.removeSecret("mail.\(field)") }
	}

	/// Run work in one logged-in session, optionally with a mailbox selected.
	func session<T: Sendable>(_ mailbox: String? = nil, account: MailAccount? = nil, _ body: (IMAPClient) async throws -> T) async throws -> T {
		let client = try await IMAPClient.connect(try (account ?? requireAccount()).imap, open: openStream)
		do {
			if let mailbox { try await client.select(mailbox) }
			let result = try await body(client)
			await client.logout()
			return result
		} catch {
			await client.logout()
			throw error
		}
	}

	// MARK: Facts

	public static func isBulk(_ headers: [String: String], fromEmail: String) -> Bool {
		if headers["list-unsubscribe"] != nil || headers["list-id"] != nil || headers["feedback-id"] != nil { return true }
		if (headers["precedence"]?.lowercased() ?? "").firstMatch(of: /\b(bulk|list|junk|auto_reply)\b/) != nil { return true }
		if let auto = headers["auto-submitted"]?.lowercased(), auto != "no" { return true }
		if headers["x-auto-response-suppress"] != nil { return true }
		return fromEmail.firstMatch(of: automatedSender) != nil
	}

	static func format(_ addresses: [MIME.Address]) -> String { addresses.map(\.display).joined(separator: ", ") }
	static func bare(_ addresses: [MIME.Address]) -> [String] { addresses.map { $0.email.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty } }
	static func iso(_ date: Date?) -> String { TodoRecurrence.isoString(date ?? Date()) }

	struct Summary: Sendable {
		var uid: Int
		var fromAddress: String
		var fromEmail: String
		var toEmails: [String]
		var subject: String
		var date: String
		var flags: [String]
		var bulk: Bool
		var messageID: String?
		var received: String?
		var ancestors: [String]
	}

	static func summaries(_ client: IMAPClient, _ uids: [Int]) async throws -> [Summary] {
		let messages = try await client.fetch(uids, items: "(UID FLAGS ENVELOPE INTERNALDATE BODY.PEEK[HEADER.FIELDS (REFERENCES \(bulkHeaders.joined(separator: " ")))])")
		return messages.map { message in
			let envelope = message.envelope
			let fromEmail = bare(envelope?.from ?? []).first ?? ""
			return Summary(
				uid: message.uid, fromAddress: format(envelope?.from ?? []), fromEmail: fromEmail, toEmails: bare(envelope?.to ?? []),
				subject: envelope?.subject ?? "", date: iso(envelope?.date), flags: message.flags, bulk: isBulk(message.headers, fromEmail: fromEmail),
				messageID: threadID(references: nil, inReplyTo: nil, messageID: envelope?.messageID),
				received: message.internalDate.map(TodoRecurrence.isoString),
				ancestors: [message.headers["references"], envelope?.inReplyTo].compactMap { $0 }.flatMap {
					$0.split(whereSeparator: \.isWhitespace).compactMap { threadID(references: nil, inReplyTo: nil, messageID: String($0)) }
				},
			)
		}.sorted { $0.date > $1.date }
	}

	/// Live unread INBOX summary plus read-but-unanswered mail from people
	/// (the plugin's `getUnreadSummary`, the Feed's email source).
	public func unreadSummary(limit: Int = 20, awaitingLimit: Int = 8, awaitingDays: Int = 7, now: Date = Date(), forFeed: Bool = false) async throws -> JSONValue {
		let account = try requireAccount()
		let selfSet = Set(account.selfAddresses.map { $0.lowercased() })
		let (count, unread, awaiting, validity) = try await session(Self.defaultMailbox, account: account) { client in
			let count = try await client.unseenCount(Self.defaultMailbox)
			let unseen = try await client.search("UNSEEN")
			let messages = try await Self.summaries(client, Array(unseen.suffix(limit)))
			var awaiting: [Summary] = []
			if awaitingLimit > 0 {
				let since = IMAPClient.searchDate(now.addingTimeInterval(-Double(awaitingDays) * 86400))
				let read = try await client.search("SEEN UNANSWERED SINCE \(since)")
				awaiting = Array(try await Self.summaries(client, Array(read.suffix(60))).filter { !$0.bulk && !$0.fromEmail.isEmpty && !selfSet.contains($0.fromEmail) }.prefix(awaitingLimit))
			}
			return (count, messages, awaiting, await client.uidValidity)
		}
		let correspondents = (try? correspondentAddresses(account.selfAddresses)) ?? []
		func item(_ m: Summary, unread: Bool) -> JSONValue {
			var email: [String: JSONValue] = ["unread": .bool(unread), "bulk": .bool(m.bulk), "knownSender": .bool(!m.fromEmail.isEmpty && correspondents.contains(m.fromEmail))]
			if m.toEmails.contains(where: selfSet.contains) { email["direct"] = true }
			if !unread { email["awaitingReply"] = true }
			var item: [String: JSONValue] = [
				"id": .string("\(m.uid):\(Self.defaultMailbox)"), "title": .string(m.subject.isEmpty ? "(no subject)" : m.subject), "subtitle": .string(m.fromAddress),
				"timestamp": .string(m.date), "urgency": .string(m.flags.contains("\\Flagged") ? "high" : "normal"), "email": .object(email),
			]
			if forFeed {
				item["identity"] = [
					"account": .string(account.feedScope), "message": m.messageID.map(JSONValue.string) ?? .null,
					"received": m.received.map(JSONValue.string) ?? .null, "ancestors": .array(m.ancestors.map(JSONValue.string)),
					"uid": .number(Double(m.uid)), "generation": validity.map { .number(Double($0)) } ?? .null,
				]
			}
			return .object(item)
		}
		let incoming = forFeed ? unread.filter { !selfSet.contains($0.fromEmail) } : unread
		let unreadIDs = Set(incoming.map(\.uid))
		var result: [String: JSONValue] = [
			"count": .number(Double(count)),
			"items": .array(incoming.map { item($0, unread: true) } + awaiting.filter { !unreadIDs.contains($0.uid) }.map { item($0, unread: false) }),
			"generatedAt": .string(TodoRecurrence.isoString(now)),
		]
		if let launch = Self.webmailURL(account.imap.host) { result["launchUrl"] = .string(launch) }
		return .object(result)
	}

	public static func webmailURL(_ imapHost: String) -> String? {
		let host = imapHost.lowercased()
		if host.contains("gmail") || host.contains("googlemail") { return "https://mail.google.com/mail/u/0/#inbox" }
		if ["outlook", "office365", "hotmail", "live.com"].contains(where: host.contains) { return "https://outlook.office.com/mail/" }
		if host.contains("yahoo") { return "https://mail.yahoo.com/" }
		if ["icloud", "me.com", "mac.com"].contains(where: host.contains) { return "https://www.icloud.com/mail" }
		if host.contains("proton") { return "https://mail.proton.me/u/0/inbox" }
		if host.contains("fastmail") { return "https://app.fastmail.com/mail/Inbox" }
		if host.contains("zoho") { return "https://mail.zoho.com/" }
		return nil
	}

	// MARK: Cache

	/// People the user has written to (from cached mail they sent).
	public func correspondentAddresses(_ selfAddresses: [String], limit: Int = 2000) throws -> Set<String> {
		let selfList = selfAddresses.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
		guard !selfList.isEmpty else { return [] }
		let rows = try writer.read { db in
			try Row.fetchAll(db, sql: """
			SELECT to_address, cc_address FROM mail_messages WHERE \(selfList.map { _ in "LOWER(from_address) LIKE ?" }.joined(separator: " OR "))
			ORDER BY date DESC LIMIT ?
			""", arguments: StatementArguments(selfList.map { "%\($0)%" } + [String(limit)])).map { "\(($0["to_address"] as String?) ?? "") \(($0["cc_address"] as String?) ?? "")" }
		}
		var out = Set<String>()
		for text in rows {
			for match in text.matches(of: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) {
				let address = String(match.0).lowercased()
				if !selfList.contains(address) { out.insert(address) }
			}
		}
		return out
	}

	static let summaryColumns = "uid, mailbox, from_address, to_address, subject, date, snippet, flags, has_body"

	static func summaryJSON(_ row: Row) -> JSONValue {
		let snippet = ((row["snippet"] as String?) ?? "").replacingOccurrences(of: "\r\n", with: " ").replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
		return [
			"uid": .number(Double(row["uid"] as Int)), "mailbox": .string(row["mailbox"]), "from": .string(row["from_address"] ?? ""),
			"to": .string(row["to_address"] ?? ""), "subject": .string(row["subject"] ?? ""), "date": .string(row["date"] ?? ""),
			"snippet": .string(snippet.count <= 200 ? snippet : String(snippet.prefix(199)) + "…"), "flags": .string(row["flags"] ?? ""),
			"hasBody": .bool((row["has_body"] as Int?) == 1),
		]
	}

	public func cachedMessages(_ mailbox: String, limit: Int, offset: Int) throws -> (messages: [JSONValue], total: Int) {
		try writer.read { db in
			let rows = try Row.fetchAll(db, sql: "SELECT \(Self.summaryColumns) FROM mail_messages WHERE mailbox = ? ORDER BY date DESC LIMIT ? OFFSET ?", arguments: [mailbox, limit, offset])
			return (rows.map(Self.summaryJSON), try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM mail_messages WHERE mailbox = ?", arguments: [mailbox]) ?? 0)
		}
	}

	/// Re-sync one mailbox: prune deleted, refresh recent flags, add new.
	@discardableResult
	public func sync(_ mailbox: String = MailService.defaultMailbox) async throws -> (newCount: Int, lastUid: Int) {
		let (lastUid, maxCached, cached): (Int, Int, [Int]) = try await writer.read { db in
			(try Int.fetchOne(db, sql: "SELECT last_uid FROM mail_sync_state WHERE mailbox = ?", arguments: [mailbox]) ?? 0,
			 try Int.fetchOne(db, sql: "SELECT MAX(uid) FROM mail_messages WHERE mailbox = ?", arguments: [mailbox]) ?? 0,
			 try Int.fetchAll(db, sql: "SELECT uid FROM mail_messages WHERE mailbox = ? ORDER BY uid ASC", arguments: [mailbox]))
		}
		let (serverUIDs, flags, fresh) = try await session(mailbox) { client in
			let server = try await client.search("ALL")
			let serverSet = Set(server)
			let refresh = Array(cached.filter(serverSet.contains).suffix(500))
			let flags = try await client.fetch(refresh, items: "(UID FLAGS)")
			let fresh = try await client.fetch(server.filter { $0 > maxCached }, items: "(UID FLAGS ENVELOPE INTERNALDATE)")
			return (serverSet, flags, fresh)
		}
		let now = TodoRecurrence.isoString(Date())
		return try await writer.write { db in
			var pruned = 0
			for uid in cached where !serverUIDs.contains(uid) {
				try db.execute(sql: "DELETE FROM mail_messages WHERE uid = ? AND mailbox = ?", arguments: [uid, mailbox])
				pruned += 1
			}
			for message in flags {
				try db.execute(sql: "UPDATE mail_messages SET flags = ? WHERE uid = ? AND mailbox = ?", arguments: [message.flags.joined(separator: ","), message.uid, mailbox])
			}
			var highest = max(lastUid, maxCached)
			var added = 0
			for message in fresh where message.uid > maxCached {
				let envelope = message.envelope
				try db.execute(sql: """
				INSERT OR REPLACE INTO mail_messages (uid, mailbox, message_id, from_address, to_address, cc_address, subject, date, snippet, flags, has_body, fetched_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, 0, ?)
				""", arguments: [
					message.uid, mailbox, envelope?.messageID ?? "", Self.format(envelope?.from ?? []), Self.format(envelope?.to ?? []), Self.format(envelope?.cc ?? []),
					envelope?.subject ?? "", Self.iso(envelope?.date ?? message.internalDate), message.flags.joined(separator: ","), now,
				])
				added += 1
				highest = max(highest, message.uid)
			}
			if highest > lastUid || pruned > 0 || !flags.isEmpty {
				try db.execute(sql: "INSERT OR REPLACE INTO mail_sync_state (mailbox, last_uid, last_synced_at) VALUES (?, ?, ?)", arguments: [mailbox, highest == 0 ? lastUid : highest, now])
			}
			return (added, highest == 0 ? lastUid : highest)
		}
	}

	/// Message body (cache first, then IMAP; cached for next time).
	public func body(uid: Int, mailbox: String) async throws -> (text: String, html: String) {
		let cached: (String, String)? = try await writer.read { db in
			try Row.fetchOne(db, sql: "SELECT text_body, html_body FROM mail_messages WHERE uid = ? AND mailbox = ? AND has_body = 1", arguments: [uid, mailbox])
				.map { (($0["text_body"] as String?) ?? "", ($0["html_body"] as String?) ?? "") }
		}
		if let cached { return cached }
		let source = try await session(mailbox) { client in try await client.fetch([uid], items: "(UID BODY.PEEK[])").first?.source }
		guard let source else { throw MailError.server("Message \(uid) not found in \(mailbox).") }
		let body = MIME.body(of: source)
		try await writer.write { db in
			try db.execute(sql: "UPDATE mail_messages SET text_body = ?, html_body = ?, has_body = 1 WHERE uid = ? AND mailbox = ?", arguments: [body.text, body.html, uid, mailbox])
		}
		return (body.text, body.html)
	}

	func deleteCached(_ uids: [Int], mailbox: String) async throws {
		try await writer.write { db in
			for uid in uids { try db.execute(sql: "DELETE FROM mail_messages WHERE uid = ? AND mailbox = ?", arguments: [uid, mailbox]) }
		}
	}

	func updateCachedFlag(_ uids: [Int], mailbox: String, flag: String, add: Bool) async throws {
		try await writer.write { db in
			for uid in uids {
				guard let current = try String.fetchOne(db, sql: "SELECT flags FROM mail_messages WHERE uid = ? AND mailbox = ?", arguments: [uid, mailbox]) else { continue }
				var flags = current.split(separator: ",").map(String.init).filter { !$0.isEmpty && $0 != flag }
				if add { flags.append(flag) }
				try db.execute(sql: "UPDATE mail_messages SET flags = ? WHERE uid = ? AND mailbox = ?", arguments: [flags.joined(separator: ","), uid, mailbox])
			}
		}
	}

	/// Re-sync after a write; failures don't fail the write.
	func resync(_ mailboxes: [String]) async {
		for mailbox in Set(mailboxes.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }) { _ = try? await sync(mailbox) }
	}

	// MARK: Writes

	public func setFlags(_ uids: [Int], mailbox: String, add: [String] = [], remove: [String] = []) async throws {
		try await session(mailbox) { client in
			try await client.store(uids, add: true, flags: add)
			try await client.store(uids, add: false, flags: remove)
		}
		for flag in add { try await updateCachedFlag(uids, mailbox: mailbox, flag: flag, add: true) }
		for flag in remove { try await updateCachedFlag(uids, mailbox: mailbox, flag: flag, add: false) }
		await resync([mailbox])
	}

	public func move(_ uids: [Int], from mailbox: String, to destination: String) async throws {
		try await session(mailbox) { client in try await client.move(uids, to: destination) }
		try await deleteCached(uids, mailbox: mailbox)
		await resync([mailbox, destination])
	}

	static func archiveMailbox(_ boxes: [IMAPClient.Mailbox]) -> IMAPClient.Mailbox? {
		boxes.first { box in
			box.specialUse == "\\All" || box.path.firstMatch(of: /(?i)all[ -]?mail/) != nil || box.name.firstMatch(of: /(?i)all[ -]?mail/) != nil
				|| box.path.wholeMatch(of: /(?i)archive/) != nil || box.name.wholeMatch(of: /(?i)archive/) != nil || box.path.firstMatch(of: /(?i)all[ -]?emails?/) != nil
		}
	}

	public func archive(_ uids: [Int], from mailbox: String) async throws -> String {
		let path = try await session(nil) { client -> String in
			guard let archive = Self.archiveMailbox(try await client.list()) else {
				throw MailError.server("No archive mailbox found. Use moveToMailbox with an explicit destination instead.")
			}
			guard archive.path != mailbox else { throw MailError.server("Messages are already in the archive mailbox.") }
			try await client.select(mailbox)
			try await client.move(uids, to: archive.path)
			return archive.path
		}
		try await deleteCached(uids, mailbox: mailbox)
		await resync([mailbox, path])
		return path
	}

	public func delete(_ uids: [Int], from mailbox: String) async throws -> String? {
		let trash = try await session(nil) { client -> String? in
			let trash = try await client.list().first { box in
				box.specialUse?.lowercased() == "\\trash" || box.path.range(of: "trash", options: .caseInsensitive) != nil
			}
			try await client.select(mailbox)
			if let trash, trash.path != mailbox {
				try await client.move(uids, to: trash.path)
				return trash.path
			}
			try await client.store(uids, add: true, flags: ["\\Deleted"])
			try await client.expunge(uids)
			return nil
		}
		try await deleteCached(uids, mailbox: mailbox)
		await resync([mailbox] + (trash.map { [$0] } ?? []))
		return trash
	}

	public func mailboxes() async throws -> [IMAPClient.Mailbox] { try await session(nil) { try await $0.list() } }

	public func send(to: [String], cc: [String] = [], bcc: [String] = [], subject: String, body: String) async throws -> String {
		let account = try requireAccount()
		guard let smtp = account.smtp else { throw MailError.notConfigured("SMTP credentials not configured.") }
		let address = account.fromAddress.isEmpty ? smtp.username : account.fromAddress
		let from = account.fromName.isEmpty ? address : "\(account.fromName) <\(address)>"
		return try await SMTPClient.send(.init(from: from, to: to, cc: cc, bcc: bcc, subject: subject, body: body), server: smtp, open: openStream)
	}

	// MARK: Drafts (local, as in the plugin)

	public func createDraft(to: [String], cc: [String], bcc: [String], subject: String, body: String) async throws -> String {
		let id = "draft-\(Int(Date().timeIntervalSince1970 * 1000))-\(String(UInt64.random(in: 0 ... UInt64.max), radix: 16).prefix(10))"
		let now = TodoRecurrence.isoString(Date())
		try await writer.write { db in
			try db.execute(sql: "INSERT INTO mail_drafts (id, to_address, cc_address, bcc_address, subject, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			               arguments: [id, to.joined(separator: ", "), cc.joined(separator: ", "), bcc.joined(separator: ", "), subject, body, now, now])
		}
		return id
	}

	static func draftJSON(_ row: Row) -> JSONValue {
		[
			"id": .string(row["id"]), "to": .string(row["to_address"] ?? ""), "cc": .string(row["cc_address"] ?? ""), "bcc": .string(row["bcc_address"] ?? ""),
			"subject": .string(row["subject"] ?? ""), "body": .string(row["body"] ?? ""), "createdAt": .string(row["created_at"] ?? ""), "updatedAt": .string(row["updated_at"] ?? ""),
		]
	}

	/// A draft as `{id, to, cc, bcc, subject, body, createdAt, updatedAt}` (addresses comma-joined).
	public func draft(_ id: String) async throws -> JSONValue? {
		try await writer.read { db in try Row.fetchOne(db, sql: "SELECT * FROM mail_drafts WHERE id = ?", arguments: [id]).map(Self.draftJSON) }
	}

	public func updateDraft(_ id: String, fields: [String: String]) async throws {
		guard !fields.isEmpty else { return }
		try await writer.write { db in
			let sets = fields.keys.sorted()
			try db.execute(sql: "UPDATE mail_drafts SET \(sets.map { "\($0) = ?" }.joined(separator: ", ")), updated_at = ? WHERE id = ?",
			               arguments: StatementArguments(sets.map { fields[$0]! } + [TodoRecurrence.isoString(Date()), id]))
		}
	}

	public func listDrafts(limit: Int) async throws -> [JSONValue] {
		try await writer.read { db in try Row.fetchAll(db, sql: "SELECT * FROM mail_drafts ORDER BY updated_at DESC LIMIT ?", arguments: [limit]).map(Self.draftJSON) }
	}

	@discardableResult
	public func deleteDraft(_ id: String) async throws -> Bool {
		try await writer.write { db in
			try db.execute(sql: "DELETE FROM mail_drafts WHERE id = ?", arguments: [id])
			return db.changesCount > 0
		}
	}

	// MARK: Activity (observation ledger)

	/// First message id in `References` / `In-Reply-To` / `Message-ID`, lowercased.
	public static func threadID(references: String?, inReplyTo: String?, messageID: String?) -> String? {
		func first(_ raw: String?) -> String? {
			guard let raw else { return nil }
			if let match = raw.firstMatch(of: /<([^<>]+)>/) { return String(match.1) }
			return raw.trimmingCharacters(in: .whitespaces).split(whereSeparator: \.isWhitespace).first.map(String.init)
		}
		let id = [first(references), first(inReplyTo), first(messageID)].compactMap { $0?.nilIfEmpty }.first
		return id?.replacingOccurrences(of: "<", with: "").replacingOccurrences(of: ">", with: "").lowercased().nilIfEmpty
	}

	/// Body text up to the first quoted-reply marker (≤ 2000 chars).
	public static func trimSnippet(_ text: String) -> String {
		var lines: [String] = []
		for line in text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
			if line.firstMatch(of: /(?i)^\s*(?:>|On .+wrote:|--\s*$|[-_]{2,}\s*Original Message|From:\s|Sent from my\b)/) != nil { break }
			lines.append(line)
		}
		return String(lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000))
	}

	/// INBOX and Sent mail since `since`, oldest first (read-only; bodies peeked).
	public func recentActivity(since: String, limit: Int = 200) async throws -> ActivityResult {
		guard let cutoff = TodoRecurrence.parseISO(since) else { throw MailError.server("since must be an ISO 8601 timestamp with an offset.") }
		let cap = max(1, min(1000, limit))
		let account = try requireAccount()
		let selfSet = Set(account.selfAddresses.map { $0.lowercased() })
		let headerFields = (Self.bulkHeaders + ["REFERENCES"]).joined(separator: " ")
		let collected: [(mailbox: String, message: IMAPClient.Message, text: String)] = try await session(nil) { client in
			let boxes = try await client.list()
			let sent = boxes.first { $0.specialUse == "\\Sent" } ?? ["Sent", "Sent Items", "Sent Messages", "[Gmail]/Sent Mail"].lazy.compactMap { name in
				boxes.first { $0.path.lowercased() == name.lowercased() || $0.name.lowercased() == name.lowercased() }
			}.first
			var out: [(String, IMAPClient.Message, String)] = []
			for mailbox in [Self.defaultMailbox] + (sent.map { [$0.path] } ?? []) {
				try await client.select(mailbox, readOnly: true)
				let uids = try await client.search("SINCE \(IMAPClient.searchDate(cutoff))")
				guard !uids.isEmpty else { continue }
				let metadata = try await client.fetch(uids, items: "(UID FLAGS ENVELOPE INTERNALDATE BODY.PEEK[HEADER.FIELDS (\(headerFields))])")
				let batch = metadata.filter { ($0.envelope?.date ?? $0.internalDate ?? .distantPast) >= cutoff }
					.sorted { ($0.envelope?.date ?? $0.internalDate ?? .distantPast) < ($1.envelope?.date ?? $1.internalDate ?? .distantPast) }.prefix(cap)
				let bodies = try await client.fetch(batch.map(\.uid), items: "(UID BODY.PEEK[]<0.32768>)")
				let textByUID = Dictionary(bodies.map { ($0.uid, $0.source.map { MIME.body(of: $0).text } ?? "") }, uniquingKeysWith: { a, _ in a })
				for message in batch { out.append((mailbox, message, textByUID[message.uid] ?? "")) }
			}
			return out
		}
		var seen = Set<String>()
		var observations: [ObservationInput] = []
		for (mailbox, message, text) in collected.sorted(by: { ($0.message.envelope?.date ?? $0.message.internalDate ?? .distantPast) < ($1.message.envelope?.date ?? $1.message.internalDate ?? .distantPast) }) {
			guard let date = message.envelope?.date ?? message.internalDate, date >= cutoff else { continue }
			let envelope = message.envelope
			let external = envelope?.messageID.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? "\(mailbox):\(message.uid)"
			guard seen.insert(external).inserted else { continue }
			var actors: [JSONValue] = []
			for (role, list) in [("from", envelope?.from ?? []), ("to", envelope?.to ?? []), ("cc", envelope?.cc ?? [])] {
				for address in list {
					var actor: [String: JSONValue] = ["role": .string(role)]
					if let name = address.name { actor["name"] = .string(String(name.prefix(200))) }
					if !address.email.isEmpty { actor["email"] = .string(String(address.email.trimmingCharacters(in: .whitespaces).lowercased().prefix(320))) }
					actors.append(.object(actor))
				}
			}
			let fromEmail = envelope?.from.first?.email ?? ""
			let outbound = (envelope?.from ?? []).contains { selfSet.contains($0.email.trimmingCharacters(in: .whitespaces).lowercased()) }
			var observation = ObservationInput(
				externalID: external, kind: "email.message",
				threadID: Self.threadID(references: message.headers["references"], inReplyTo: envelope?.inReplyTo, messageID: envelope?.messageID),
				direction: outbound ? "outbound" : "inbound", occurredAt: TodoRecurrence.isoString(date), title: String((envelope?.subject ?? "").prefix(1000)),
				excerpt: Self.trimSnippet(text), actors: Array(actors.prefix(100)),
			)
			observation.facts = [
				"bulk": .bool(Self.isBulk(message.headers, fromEmail: fromEmail)),
				"direct": .bool((envelope?.to ?? []).contains { selfSet.contains($0.email.trimmingCharacters(in: .whitespaces).lowercased()) }),
				"mailbox": .string(mailbox), "seen": .bool(message.flags.contains("\\Seen")), "answered": .bool(message.flags.contains("\\Answered")),
				"flagged": .bool(message.flags.contains("\\Flagged")),
			]
			observations.append(observation)
			if observations.count >= cap { break }
		}
		return ActivityResult(observations: observations, selfEmails: Array(selfSet))
	}

	// MARK: Background sync

	/// Sync INBOX every `interval` while configured (the daemon's events poll).
	public func runSyncLoop(interval: Duration = .seconds(300)) async {
		while !Task.isCancelled {
			if isConfigured {
				do {
					let result = try await sync()
					if result.newCount > 0 { TobyLog.shared.info("mail", "mail_sync_complete", ["newCount": .number(Double(result.newCount))]) }
				} catch {
					TobyLog.shared.warn("mail", "mail_sync_failed", ["error": .string((error as? LocalizedError)?.errorDescription ?? "\(error)")])
				}
			}
			try? await Task.sleep(for: interval)
		}
	}
}

/// The Feed's email source: unread + awaiting-reply mail; archive and mark read.
public struct MailFeedSource: FeedSource {
	let mail: MailService
	public init(mail: MailService) { self.mail = mail }
	public var category: String { "email" }
	public var accountScope: String? { mail.account()?.feedScope }
	public var providerName: String { "email" }
	public var providerDisplayName: String { "Email" }
	public var launchURL: String? { mail.account().flatMap { MailService.webmailURL($0.imap.host) } }
	public var itemActions: Set<String> { ["email.archiveItem", "email.markItemRead"] }

	public func summary(limit: Int) async throws -> JSONValue {
		guard mail.isConfigured else { throw MailError.notConfigured("Email isn't connected.") }
		return try await mail.unreadSummary(limit: limit, forFeed: true)
	}

	/// `uid:mailbox` item ids.
	public static func parseItemID(_ raw: String) -> (uid: Int, mailbox: String)? {
		let parts = raw.split(separator: ":", maxSplits: 1).map(String.init)
		guard let uid = Int(parts.first ?? ""), uid > 0 else { return nil }
		let mailbox = parts.count > 1 ? parts[1] : MailService.defaultMailbox
		return mailbox.isEmpty ? nil : (uid, mailbox)
	}

	public func run(itemAction: String, itemID: String) async throws -> String {
		guard let ref = Self.parseItemID(itemID) else { throw TodoError.invalid("id must be a dashboard item id (uid:mailbox).") }
		switch itemAction {
		case "email.archiveItem":
			_ = try await mail.archive([ref.uid], from: ref.mailbox)
			return "Archived."
		case "email.markItemRead":
			try await mail.setFlags([ref.uid], mailbox: ref.mailbox, add: ["\\Seen"])
			return "Marked as read."
		default:
			throw TodoError.invalid("Unsupported action.")
		}
	}
}
