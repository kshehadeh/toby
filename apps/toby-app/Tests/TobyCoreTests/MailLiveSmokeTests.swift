import Foundation
import Testing
import TobyAI
@testable import TobyCore
import TobyMail
import TobyStore

/// Opt-in, read-only: import a copied home's mail account into memory and
/// talk to the real server (STATUS/SEARCH/FETCH with BODY.PEEK only).
/// Prints counts and field presence, never message content.
@Suite("Mail live smoke (opt-in)")
struct MailLiveSmokeTests {
	@Test(.enabled(if: ProcessInfo.processInfo.environment["TOBY_MAIL_LIVE_DIR"] != nil))
	func readsTheRealInbox() async throws {
		let paths = TobyPaths(root: URL(fileURLWithPath: ProcessInfo.processInfo.environment["TOBY_MAIL_LIVE_DIR"]!))
		let database = try TobyDatabase.open(paths: paths)
		let secrets = InMemorySecretStore()
		_ = try LegacyImporter(paths: paths, database: database, secrets: secrets, openRouterKeyStore: nil).run(force: true)
		let mail = MailService(writer: database.writer, secrets: secrets)
		let account = try #require(mail.account())
		print("LIVE imap port=\(account.imap.port) secure=\(account.imap.secure) smtp=\(account.smtp != nil)")
		let boxes = try await mail.mailboxes()
		print("LIVE mailboxes=\(boxes.count) special=\(boxes.compactMap(\.specialUse).sorted()) archive=\(MailService.archiveMailbox(boxes) != nil)")
		let summary = try await mail.unreadSummary()
		let items = summary["items"]?.arrayValue ?? []
		print("LIVE unread=\(summary["count"]?.intValue ?? -1) items=\(items.count) awaiting=\(items.filter { $0["email"]?["awaitingReply"] == true }.count) bulk=\(items.filter { $0["email"]?["bulk"] == true }.count) known=\(items.filter { $0["email"]?["knownSender"] == true }.count) direct=\(items.filter { $0["email"]?["direct"] == true }.count)")
		print("LIVE subjects-nonempty=\(items.filter { ($0["title"]?.stringValue ?? "") != "(no subject)" }.count) senders-nonempty=\(items.filter { !($0["subtitle"]?.stringValue ?? "").isEmpty }.count) dated=\(items.filter { $0["timestamp"]?.stringValue != nil }.count)")
		let before = try mail.cachedMessages("INBOX", limit: 1000, offset: 0).total
		let sync = try await mail.sync()
		let after = try mail.cachedMessages("INBOX", limit: 1000, offset: 0).total
		print("LIVE sync new=\(sync.newCount) cachedBefore=\(before) cachedAfter=\(after)")
		if let first = items.first?["id"]?.stringValue, let ref = MailFeedSource.parseItemID(first) {
			let body = try await mail.body(uid: ref.uid, mailbox: ref.mailbox)
			print("LIVE body textChars=\(body.text.count) htmlChars=\(body.html.count)")
		}
	}
}
