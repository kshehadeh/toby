import Foundation
import TobyMail
import TobyAI

/// One message as the email reader shows it.
public struct MailMessageDetail: Sendable {
	public var uid: Int
	public var mailbox: String
	public var subject: String
	public var from: [MIME.Address]
	public var to: [MIME.Address]
	public var cc: [MIME.Address]
	public var date: Date?
	public var isUnread: Bool
	public var isFlagged: Bool
	public var content: MIME.Content
	/// Web inbox for the account, when the provider is known.
	public var webmailURL: String?
}

extension MailService {
	/// Fetch a full message for reading. Uses `BODY.PEEK`, so opening a message
	/// never marks it read on the server.
	public func message(uid: Int, mailbox: String, identity: JSONValue? = nil) async throws -> MailMessageDetail {
		let account = try requireAccount()
		if let identity, identity["account"]?.stringValue != account.feedScope { throw MailError.server("This message belongs to another account.") }
		let fetched = try await session(mailbox, account: account) { client in
			let message = try await client.fetch([uid], items: "(UID FLAGS ENVELOPE INTERNALDATE BODY.PEEK[])").first { $0.uid == uid }
			if let identity { try await validateFeedTarget(identity, account: account, validity: client.uidValidity, message: message) }
			return message
		}
		guard let fetched, let source = fetched.source else {
			throw MailError.server("This message is no longer in \(mailbox == Self.defaultMailbox ? "your inbox" : mailbox). It may have been moved or deleted.")
		}
		let envelope = fetched.envelope
		return MailMessageDetail(
			uid: uid, mailbox: mailbox, subject: envelope?.subject ?? "", from: envelope?.from ?? [], to: envelope?.to ?? [], cc: envelope?.cc ?? [],
			date: envelope?.date ?? fetched.internalDate, isUnread: !fetched.flags.contains("\\Seen"), isFlagged: fetched.flags.contains("\\Flagged"),
			content: MIME.content(of: source), webmailURL: Self.webmailURL(account.imap.host),
		)
	}
}
