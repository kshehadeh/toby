import Foundation

/// Identifies a message in the connected mailbox (`uid:mailbox`).
struct EmailReference: Hashable, Sendable {
	let uid: Int
	let mailbox: String

	static let defaultMailbox = "INBOX"

	init(uid: Int, mailbox: String = Self.defaultMailbox) {
		self.uid = uid
		self.mailbox = mailbox
	}

	/// Parses a Feed `itemId` such as `42:INBOX`; a bare uid means the inbox.
	init?(itemID: String) {
		let parts = itemID.split(separator: ":", maxSplits: 1).map(String.init)
		guard let first = parts.first, let uid = Int(first), uid > 0 else { return nil }
		self.init(uid: uid, mailbox: parts.count > 1 ? parts[1] : Self.defaultMailbox)
	}
}

struct EmailAddress: Hashable, Sendable {
	var name: String?
	var email: String

	/// The name when there is one, otherwise the address.
	var displayName: String {
		let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return trimmed.isEmpty ? email : trimmed
	}

	/// One or two letters for the sender badge.
	var initials: String {
		let words = displayName.split { !$0.isLetter && !$0.isNumber }
		let letters = name?.isEmpty == false ? [words.first, words.count > 1 ? words.last : nil] : [words.first]
		let text = letters.compactMap { $0?.first }.map { String($0).uppercased() }.joined()
		return text.isEmpty ? "?" : text
	}
}

struct EmailAttachment: Identifiable, Equatable, Sendable {
	let id: Int
	let filename: String
	let mimeType: String
	let data: Data

	var sizeText: String { ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file) }

	var systemImage: String {
		if mimeType.hasPrefix("image/") { return "photo" }
		if mimeType.hasPrefix("video/") { return "film" }
		if mimeType.hasPrefix("audio/") { return "waveform" }
		if mimeType == "text/calendar" { return "calendar" }
		if mimeType == "message/rfc822" { return "envelope" }
		if mimeType == "application/pdf" { return "doc.richtext" }
		if mimeType.contains("zip") || mimeType.contains("compressed") { return "doc.zipper" }
		return "doc"
	}
}

/// A full message for the email reader.
struct EmailMessage: Equatable, Sendable {
	var reference: EmailReference
	var subject: String
	var from: [EmailAddress]
	var to: [EmailAddress]
	var cc: [EmailAddress]
	var date: Date?
	var isUnread: Bool
	var isFlagged: Bool
	var text: String
	var html: String
	var attachments: [EmailAttachment]
	var webmailURL: URL?
}
