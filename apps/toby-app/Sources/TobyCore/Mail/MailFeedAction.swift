import Foundation
import TobyAI
import TobyMail

extension MailService {
	func validateFeedTarget(_ identity: JSONValue, account: MailAccount, validity: Int?, message: IMAPClient.Message?) throws {
		let stableID = identity["message"]?.stringValue
		guard identity["account"]?.stringValue == account.feedScope,
		      identity["generation"]?.intValue == validity,
		      validity != nil || stableID != nil else {
			throw TodoError.invalid("This mailbox changed. Refresh The Feed.")
		}
		if let message, let stableID,
		   Self.threadID(references: nil, inReplyTo: nil, messageID: message.envelope?.messageID) != stableID {
			throw TodoError.invalid("This message changed. Refresh The Feed.")
		}
	}

	/// Check and use the UID on one selected connection. A provider may reuse
	/// the UID after a mailbox reset, or the user may switch accounts.
	func feedAction(_ action: String, itemID: String, identity: JSONValue?, inspectOnly: Bool) async throws -> Bool {
		guard let ref = MailFeedSource.parseItemID(itemID), let identity else { throw TodoError.invalid("Refresh The Feed to verify this message.") }
		let account = try requireAccount()
		guard identity["account"]?.stringValue == account.feedScope else { throw TodoError.invalid("This message belongs to another account.") }
		let (handled, destination): (Bool, String?) = try await session(ref.mailbox, account: account) { client in
			let current = try await client.fetch([ref.uid], items: "(UID FLAGS ENVELOPE)").first { $0.uid == ref.uid }
			try await validateFeedTarget(identity, account: account, validity: client.uidValidity, message: current)
			guard let current else { return (true, nil) }
			switch action {
			case "email.archiveItem":
				if inspectOnly { return (false, nil) }
				guard let box = Self.archiveMailbox(try await client.list()), box.path != ref.mailbox else {
					throw MailError.server("No archive mailbox is available.")
				}
				try await client.move([ref.uid], to: box.path)
				return (true, box.path)
			case "email.markItemRead":
				if current.flags.contains("\\Seen") { return (true, nil) }
				if inspectOnly { return (false, nil) }
				try await client.store([ref.uid], add: true, flags: ["\\Seen"])
			default: throw TodoError.invalid("Unsupported email action.")
			}
			return (true, nil)
		}
		if !inspectOnly, self.account()?.feedScope == account.feedScope {
			await resync([ref.mailbox] + (destination.map { [$0] } ?? []))
		}
		return handled
	}
}
