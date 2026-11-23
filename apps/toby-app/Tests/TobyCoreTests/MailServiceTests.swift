import Foundation
import GRDB
import Testing
import TobyAI
@testable import TobyCore
import TobyMail
import TobyStore

/// An in-memory IMAP server with mailboxes of messages, enough for the
/// commands `MailService` sends.
final class FakeIMAPServer: @unchecked Sendable {
	struct Message {
		var uid: Int
		var flags: [String]
		var from: (String?, String)
		var to: String
		var subject: String
		var date: String
		var messageID: String? = nil
		var headers: String = ""
		var body: String = "Hello"
	}

	let lock = NSLock()
	var boxes: [String: [Message]]
	var special: [String: String]
	var commands: [String] = []
	var uidValidity = 1
	var disconnectAfterMove = false

	init(boxes: [String: [Message]], special: [String: String] = [:]) {
		self.boxes = boxes
		self.special = special
	}

	func stream() -> FakeIMAPStream { FakeIMAPStream(server: self) }

	static func quote(_ s: String?) -> String { s.map { "\"\($0)\"" } ?? "NIL" }

	func fetch(_ m: Message, items: String) -> String {
		var parts = ["UID \(m.uid)", "FLAGS (\(m.flags.joined(separator: " ")))"]
		if items.contains("ENVELOPE") {
			let at = m.from.1.split(separator: "@")
			let to = m.to.split(separator: "@")
			parts.append("ENVELOPE (\"\(m.date)\" \"\(m.subject)\" ((\(Self.quote(m.from.0)) NIL \"\(at[0])\" \"\(at[1])\")) NIL NIL ((NIL NIL \"\(to[0])\" \"\(to[1])\")) NIL NIL NIL \"<\(m.messageID ?? "\(m.uid)@x")>\")")
		}
		if items.contains("INTERNALDATE") { parts.append("INTERNALDATE \"01-Jan-2026 10:00:00 +0000\"") }
		if items.contains("HEADER.FIELDS") {
			let header = m.headers + "\r\n"
			parts.append("BODY[HEADER.FIELDS (LIST-ID)] {\(header.utf8.count)}\r\n\(header)")
		}
		if items.contains("BODY.PEEK[]") {
			let source = "Subject: \(m.subject)\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n\(m.body)"
			parts.append("BODY[] {\(source.utf8.count)}\r\n\(source)")
		}
		return "* 1 FETCH (\(parts.joined(separator: " ")))\r\n"
	}

	static func uids(_ set: String) -> [Int] {
		set.split(separator: ",").flatMap { part -> [Int] in
			let bounds = part.split(separator: ":").compactMap { Int($0) }
			return bounds.count == 2 ? Array(bounds[0] ... bounds[1]) : bounds
		}
	}

	func handle(_ line: String, selected: inout String?) -> String {
		lock.lock()
		defer { lock.unlock() }
		let tag = String(line.prefix { $0 != " " })
		let command = String(line.dropFirst(tag.count + 1))
		commands.append(command)
		let ok = "\(tag) OK done\r\n"
		let words = command.split(separator: " ").map(String.init)
		switch words.first?.uppercased() {
		case "CAPABILITY": return "* CAPABILITY IMAP4rev1 MOVE UIDPLUS\r\n" + ok
		case "LOGIN", "LOGOUT": return ok
		case "SELECT", "EXAMINE":
			selected = command.firstMatch(of: /"([^"]*)"/).map { String($0.1) }
			return "* OK [UIDVALIDITY \(uidValidity)] active\r\n" + ok
		case "STATUS":
			let unseen = boxes["INBOX", default: []].filter { !$0.flags.contains("\\Seen") }.count
			return "* STATUS INBOX (UNSEEN \(unseen))\r\n" + ok
		case "LIST":
			return boxes.keys.sorted().map { "* LIST (\\HasNoChildren\(special[$0].map { " \($0)" } ?? "")) \"/\" \"\($0)\"\r\n" }.joined() + ok
		case "UID":
			let box = boxes[selected ?? "", default: []]
			switch words[1].uppercased() {
			case "SEARCH":
				let criteria = words.dropFirst(2).joined(separator: " ")
				let found = box.filter { m in
					if criteria == "UNSEEN" { return !m.flags.contains("\\Seen") }
					if criteria.hasPrefix("SEEN UNANSWERED") { return m.flags.contains("\\Seen") && !m.flags.contains("\\Answered") }
					return true
				}
				return "* SEARCH \(found.map { "\($0.uid)" }.joined(separator: " "))\r\n" + ok
			case "FETCH":
				let wanted = Set(Self.uids(words[2]))
				return box.filter { wanted.contains($0.uid) }.map { fetch($0, items: command) }.joined() + ok
			case "STORE":
				let wanted = Set(Self.uids(words[2]))
				let flags = command.firstMatch(of: /\(([^)]*)\)/).map { $0.1.split(separator: " ").map(String.init) } ?? []
				let add = words[3].hasPrefix("+")
				boxes[selected ?? ""] = box.map { m in
					guard wanted.contains(m.uid) else { return m }
					var m = m
					m.flags = add ? Array(Set(m.flags + flags)).sorted() : m.flags.filter { !flags.contains($0) }
					return m
				}
				return ok
			case "MOVE":
				let wanted = Set(Self.uids(words[2]))
				let destination = command.firstMatch(of: /"([^"]*)"$/).map { String($0.1) } ?? ""
				var moved = box.filter { wanted.contains($0.uid) }
				let base = (boxes[destination]?.map(\.uid).max() ?? 0)
				for index in moved.indices { moved[index].uid = base + index + 1 }
				boxes[selected ?? ""] = box.filter { !wanted.contains($0.uid) }
				boxes[destination, default: []] += moved
				if disconnectAfterMove {
					disconnectAfterMove = false
					return "* BYE interrupted\r\n"
				}
				return ok
			default: return "\(tag) BAD unknown\r\n"
			}
		default: return "\(tag) BAD unknown\r\n"
		}
	}
}

actor FakeIMAPStream: MailStream {
	let server: FakeIMAPServer
	var buffer = Data("* OK ready\r\n".utf8)
	var selected: String?

	init(server: FakeIMAPServer) { self.server = server }

	func readLine() async throws -> Data {
		guard let range = buffer.firstRange(of: Data([13, 10])) else { throw MailError.closed }
		defer { buffer.removeSubrange(buffer.startIndex ..< range.upperBound) }
		return Data(buffer[buffer.startIndex ..< range.lowerBound])
	}

	func readBytes(_ count: Int) async throws -> Data {
		defer { buffer.removeFirst(count) }
		return Data(buffer.prefix(count))
	}

	func write(_ data: Data) async throws {
		let line = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .newlines)
		buffer.append(Data(server.handle(line, selected: &selected).utf8))
	}

	func startTLS() async throws {}
	func close() async {}
}

@Suite("Mail service")
struct MailServiceTests {
	let database: TobyDatabase
	let secrets = InMemorySecretStore()
	let server: FakeIMAPServer
	let mail: MailService

	static let account = [
		"imapHost": "imap.gmail.com", "imapPort": "993", "imapSecure": "true", "imapUsername": "me@x.com", "imapPassword": "pw",
		"fromAddress": "me@x.com",
	]

	init() async throws {
		database = try TobyDatabase.inMemory()
		let now = Date()
		let recent = IMAPClient.searchDate(now)
		_ = recent
		server = FakeIMAPServer(boxes: [
			"INBOX": [
				.init(uid: 1, flags: [], from: ("Ana", "ana@y.com"), to: "me@x.com", subject: "Lunch?", date: "Mon, 2 Mar 2026 10:00:00 +0000"),
				.init(uid: 2, flags: [], from: (nil, "news@shop.com"), to: "list@shop.com", subject: "Sale", date: "Mon, 2 Mar 2026 11:00:00 +0000", headers: "List-ID: <shop>"),
				.init(uid: 3, flags: ["\\Seen"], from: ("Bo", "bo@y.com"), to: "me@x.com", subject: "Contract", date: "Sun, 1 Mar 2026 09:00:00 +0000", body: "Please sign."),
			],
			"[Gmail]/All Mail": [],
			"Sent": [],
		], special: ["[Gmail]/All Mail": "\\All"])
		let server = server
		mail = MailService(writer: database.writer, secrets: secrets) { _, _, _ in server.stream() }
		try await mail.connect(Self.account)
	}

	@Test func connectSavesSecretsAndParsesTheAccount() throws {
		#expect(try secrets.secret("mail.imapHost") == "imap.gmail.com")
		#expect(try secrets.secret("mail.smtpHost") == nil)
		#expect(mail.account()?.imap == MailServer(host: "imap.gmail.com", port: 993, secure: true, username: "me@x.com", password: "pw"))
		#expect(mail.account()?.smtp == nil)
		#expect(MailAccount(["imapHost": "h", "imapUsername": "u"]) == nil)
	}

	@Test func syncCachesPrunesAndRefreshesFlags() async throws {
		#expect(try await mail.sync().newCount == 3)
		let page = try mail.cachedMessages("INBOX", limit: 10, offset: 0)
		#expect(page.total == 3)
		#expect(page.messages.first?["subject"] == "Sale")
		#expect(page.messages.first?["from"] == "news@shop.com")
		#expect(page.messages.last?["from"] == "Bo <bo@y.com>")
		server.lock.withLock {
			server.boxes["INBOX"]!.removeAll { $0.uid == 2 }
			server.boxes["INBOX"]![0].flags = ["\\Seen"]
		}
		let second = try await mail.sync()
		#expect(second.newCount == 0)
		let after = try mail.cachedMessages("INBOX", limit: 10, offset: 0).messages
		#expect(after.count == 2)
		#expect(after.first { $0["uid"] == 1 }?["flags"] == "\\Seen")
	}

	@Test func unreadSummaryCarriesEmailFacts() async throws {
		_ = try await mail.createDraft(to: [], cc: [], bcc: [], subject: "", body: "")
		try await database.writer.write { db in
			try db.execute(sql: "INSERT INTO mail_messages (uid, mailbox, from_address, to_address, subject, date) VALUES (9, 'Sent', 'me@x.com', 'Bo <bo@y.com>', 'Hi', '2026-02-01')")
		}
		let summary = try await mail.unreadSummary(now: Date(timeIntervalSince1970: 1_772_500_000))
		#expect(summary["count"] == 2)
		#expect(summary["launchUrl"] == "https://mail.google.com/mail/u/0/#inbox")
		let items = summary["items"]?.arrayValue ?? []
		#expect(items.compactMap { $0["id"]?.stringValue } == ["2:INBOX", "1:INBOX", "3:INBOX"])
		#expect(items[0]["email"]?["bulk"] == true)
		#expect(items[1]["email"]?["direct"] == true)
		#expect(items[1]["email"]?["knownSender"] == false)
		#expect(items[2]["email"]?["awaitingReply"] == true)
		#expect(items[2]["email"]?["knownSender"] == true)
	}

	@Test func feedActionsArchiveAndMarkRead() async throws {
		try await mail.sync()
		let source = MailFeedSource(mail: mail)
		#expect(try await source.run(itemAction: "email.markItemRead", itemID: "1:INBOX") == "Marked as read.")
		#expect(server.lock.withLock { server.boxes["INBOX"]!.first { $0.uid == 1 }?.flags } == ["\\Seen"])
		#expect(try await source.run(itemAction: "email.archiveItem", itemID: "2:INBOX") == "Archived.")
		#expect(server.lock.withLock { server.boxes["[Gmail]/All Mail"]!.map(\.subject) } == ["Sale"])
		#expect(try mail.cachedMessages("INBOX", limit: 10, offset: 0).total == 2)
		#expect(try mail.cachedMessages("[Gmail]/All Mail", limit: 10, offset: 0).total == 1)
		await #expect(throws: TodoError.self) { try await source.run(itemAction: "email.archiveItem", itemID: "x") }
	}

	@Test func readsAFullMessageWithoutMarkingItRead() async throws {
		let message = try await mail.message(uid: 1, mailbox: "INBOX")
		#expect(message.subject == "Lunch?")
		#expect(message.from == [MIME.Address(name: "Ana", email: "ana@y.com")])
		#expect(message.to.map(\.email) == ["me@x.com"])
		#expect(message.date == Date(timeIntervalSince1970: 1_772_445_600))
		#expect(message.isUnread)
		#expect(message.content.text == "Hello")
		#expect(message.webmailURL == "https://mail.google.com/mail/u/0/#inbox")
		#expect(server.lock.withLock { server.boxes["INBOX"]![0].flags.isEmpty && !server.commands.contains { $0.contains("STORE") } })
		#expect(try await mail.message(uid: 3, mailbox: "INBOX").isUnread == false)
		await #expect(throws: MailError.server("This message is no longer in your inbox. It may have been moved or deleted.")) {
			try await mail.message(uid: 99, mailbox: "INBOX")
		}
	}

	@Test func feedOffersEveryEmailActionToTheReader() async throws {
		let home = FileManager.default.temporaryDirectory.appending(path: "toby-feed-\(UUID().uuidString)")
		try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: home) }
		let feed = try FeedService(
			sources: [MailFeedSource(mail: mail)], todos: TodoService(writer: database.writer, tobyDirectory: home), memory: MemoryService(writer: database.writer),
			personas: PersonaService(tobyDirectory: home), ai: OpenRouterClient(keyProvider: StaticAPIKey("sk-or-test"), transport: MockTransport([])), tobyDirectory: home,
			// The ranker only picks "add to todos" for every item.
			rank: { _, _ in ["items": .array((1 ... 3).map { ["key": .string("c\($0)"), "tier": "today", "priority": 50, "reason": "r", "actions": ["todo.add"]] })] },
		)
		let content = try await feed.content()
		let item = try #require(content["items"]?.arrayValue?.first { $0["source"]?["itemId"] == "1:INBOX" })
		let id = try #require(item["id"]?.stringValue)
		#expect(item["actions"]?.arrayValue?.contains { $0["id"] == "email.archive" } == false)
		let offered = try await feed.actions(itemID: id)["actions"]?.arrayValue ?? []
		let offeredIDs = offered.compactMap { $0["id"]?.stringValue }
		for action in ["email.draftReply", "email.archive", "email.markRead", "todo.add", "snooze", "dismiss"] { #expect(offeredIDs.contains(action), "\(action)") }
		#expect(offered.first { $0["id"] == "email.draftReply" }?["prompt"]?.stringValue?.contains("`1:INBOX`") == true)
		_ = try await feed.perform(itemID: id, actionID: "email.archive")
		#expect(server.lock.withLock { server.boxes["INBOX"]!.contains { $0.uid == 1 } } == false)
		await #expect(throws: TodoError.self) { try await feed.perform(itemID: id, actionID: "task.complete") }
		await #expect(throws: TodoError.self) { try await feed.actions(itemID: "email:email:404") }
	}

	@Test func toolsReadBodiesAndManageDrafts() async throws {
		try await mail.sync()
		let tools = Dictionary(uniqueKeysWithValues: mail.tools(dryRun: false).map { ($0.tool.name, $0.tool) })
		#expect(tools.count == 18)
		let context = ToolContext(toolCallId: "c")
		let body = try await tools["getEmailBody"]!.execute(["uid": 3], context)
		#expect(body["textBody"] == "Please sign.")
		#expect(try await tools["getEmailMetadata"]!.execute(["uids": [3]], context)["messages"]?[0]?["hasBody"] == true)
		#expect(try await tools["searchEmails"]!.execute(["query": "contr"], context)["results"]?.arrayValue?.count == 1)
		#expect(try await tools["markAsRead"]!.execute(["uids": []], context)["error"] == "uids is required and must be non-empty")
		let draft = try await tools["createDraft"]!.execute(["to": ["ana@y.com"], "subject": "Re: Lunch", "body": "Sure"], context)
		let id = try #require(draft["id"]?.stringValue)
		_ = try await tools["updateDraft"]!.execute(["id": .string(id), "subject": "Re: Lunch?"], context)
		let drafts = try await tools["listDrafts"]!.execute([:], context)["drafts"]?.arrayValue ?? []
		#expect(drafts.first?["subject"] == "Re: Lunch?")
		#expect(drafts.first?["bodyPreview"] == "Sure")
		#expect(drafts.first?["to"] == "ana@y.com")
		let failed = try await tools["sendDraft"]!.execute(["id": .string(id)], context)
		#expect(failed["error"] == "SMTP credentials not configured.")
		let dry = try await mail.tools(dryRun: true).first { $0.tool.name == "sendEmail" }!.tool.execute(["to": ["a@b.c"]], context)
		#expect(dry["dryRun"] == true)
	}

	@Test func bulkDetectionMatchesThePlugin() {
		#expect(MailService.isBulk(["precedence": "bulk"], fromEmail: "a@b.c"))
		#expect(MailService.isBulk(["auto-submitted": "auto-generated"], fromEmail: "a@b.c"))
		#expect(!MailService.isBulk(["auto-submitted": "no"], fromEmail: "a@b.c"))
		#expect(MailService.isBulk([:], fromEmail: "no-reply@b.c"))
		#expect(!MailService.isBulk([:], fromEmail: "ana@b.c"))
	}
}

extension MailServiceTests {
	@Test func archivedConversationOnlyReturnsForNewDelivery() async throws {
		let home = try temporaryHome()
		server.lock.withLock {
			server.boxes["INBOX"]![1].headers = "References: <1@x>"
			server.boxes["INBOX"]![2].subject = "Sale"
		}
		let feed = try conversationFeed(home)

		let initial = try await feed.content()["items"]?.arrayValue ?? []
		#expect(initial.count == 2)
		let shown = try #require(initial.first { $0["source"]?["itemId"] == "2:INBOX" })
		let target = try #require(shown["id"]?.stringValue)
		_ = try await feed.perform(itemID: target, actionID: "email.archive")
		let refreshed = try await feed.content(force: true)["items"]?.arrayValue ?? []
		#expect(refreshed.compactMap { $0["source"]?["itemId"]?.stringValue } == ["3:INBOX"])
		server.lock.withLock {
			var reply = server.boxes["INBOX"]![0]
			reply.uid = 4
			reply.headers = "References: <1@x> <2@x>"
			server.boxes["INBOX"]!.append(reply)
			var duplicate = server.boxes["INBOX"]![0]
			duplicate.messageID = "1@x"
			duplicate.uid = 5
			server.boxes["INBOX"]!.append(duplicate)
		}
		let next = try await feed.content(force: true)["items"]?.arrayValue ?? []
		let reply = try #require(next.first { $0["source"]?["itemId"] == "4:INBOX" })
		#expect(reply["source"]?["cardId"] == shown["source"]?["cardId"])
		#expect(try await feed.perform(itemID: target, actionID: "email.archive")["ok"] == true)
		server.lock.withLock { server.uidValidity += 1 }
		let replyID = try #require(reply["id"]?.stringValue)
		await #expect(throws: TodoError.self) { try await feed.perform(itemID: replyID, actionID: "email.archive") }
		#expect(server.lock.withLock { server.boxes["INBOX"]!.contains { $0.uid == 4 } })
	}
}

extension MailServiceTests {
	private func conversationFeed(_ home: URL, now: Date = Date()) throws -> FeedService {
		try FeedService(
			sources: [MailFeedSource(mail: mail)], todos: TodoService(writer: database.writer, tobyDirectory: home),
			memory: MemoryService(writer: database.writer), personas: PersonaService(tobyDirectory: home),
			ai: OpenRouterClient(keyProvider: StaticAPIKey("test")), tobyDirectory: home, clock: { now },
			rank: { _, _ in FeedServiceTests.allThree }
		)
	}

	@Test func reconcilesArchiveWhenServerDisconnectsAfterMove() async throws {
		let home = try temporaryHome()
		let feed = try conversationFeed(home)
		let items = try await feed.content()["items"]?.arrayValue ?? []
		let target = try #require(items.first { $0["source"]?["itemId"] == "1:INBOX" }?["id"]?.stringValue)
		server.lock.withLock { server.disconnectAfterMove = true }
		await #expect(throws: TodoError.self) { try await feed.perform(itemID: target, actionID: "email.archive") }
		#expect(try await feed.loadState()["items"]?[target]?["kind"] == "pending")
		let restarted = try conversationFeed(home)
		_ = try await restarted.content(force: true)
		#expect(try await restarted.loadState()["items"]?[target]?["kind"] == "done")
		#expect(server.lock.withLock { server.commands.filter { $0.hasPrefix("UID MOVE ") }.count } == 1)
	}

	@Test func switchingAccountRejectsOldReaderAndArchive() async throws {
		let feed = try conversationFeed(temporaryHome())
		let items = try await feed.content()["items"]?.arrayValue ?? []
		let shown = try #require(items.first { $0["source"]?["itemId"] == "1:INBOX" })
		let target = try #require(shown["id"]?.stringValue)
		try secrets.setSecret("someone-else@example.com", for: "mail.imapUsername")
		await #expect(throws: MailError.self) { try await mail.message(uid: 1, mailbox: "INBOX", identity: shown["source"]?["identity"]) }
		await #expect(throws: TodoError.self) { try await feed.perform(itemID: target, actionID: "email.archive") }
		let refreshed = try await feed.content(force: true)["items"]?.arrayValue ?? []
		#expect(refreshed.contains { $0["source"]?["itemId"] == "1:INBOX" && $0["id"]?.stringValue != target })
		#expect(server.lock.withLock { server.commands.contains { $0.hasPrefix("UID MOVE ") } } == false)
	}
}

extension MailServiceTests {
	@Test func snoozedThreadIncludesRepliesUntilTheDeadline() async throws {
		let home = try temporaryHome()
		let feed = try conversationFeed(home)
		let items = try await feed.content()["items"]?.arrayValue ?? []
		let target = try #require(items.first { $0["source"]?["itemId"] == "1:INBOX" }?["id"]?.stringValue)
		_ = try await feed.perform(itemID: target, actionID: "snooze")
		let entry = try await feed.storage.decision(target)
		let until = try #require(entry?["until"]?.stringValue.flatMap(TodoRecurrence.parseISO))
		server.lock.withLock {
			var reply = server.boxes["INBOX"]![0]
			reply.uid = 4
			reply.headers = "References: <1@x>"
			server.boxes["INBOX"]!.append(reply)
		}
		let before = try conversationFeed(home, now: until.addingTimeInterval(-1))
		let hidden = try await before.content(force: true)["items"]?.arrayValue ?? []
		#expect(!hidden.contains { $0["source"]?["itemId"] == "4:INBOX" })
		let after = try conversationFeed(home, now: until)
		let visible = try await after.content(force: true)["items"]?.arrayValue ?? []
		#expect(visible.contains { $0["source"]?["itemId"] == "4:INBOX" })
		#expect(!visible.contains { $0["source"]?["itemId"] == "1:INBOX" })
	}
}
