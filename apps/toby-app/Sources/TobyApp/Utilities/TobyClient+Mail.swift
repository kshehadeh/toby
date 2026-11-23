import Foundation
import TobyCore
import TobyMail

extension TobyClient {
	/// The full message for the email reader. Doesn't mark it read.
	func fetchEmail(_ reference: EmailReference) async throws -> EmailMessage {
		let mail = try NativeRuntime.shared.mail()
		return EmailMessage(try await mail.message(uid: reference.uid, mailbox: reference.mailbox))
	}
}

extension EmailMessage {
	init(_ detail: MailMessageDetail) {
		func addresses(_ list: [MIME.Address]) -> [EmailAddress] { list.map { EmailAddress(name: $0.name, email: $0.email) } }
		self.init(
			reference: EmailReference(uid: detail.uid, mailbox: detail.mailbox),
			subject: detail.subject,
			from: addresses(detail.from),
			to: addresses(detail.to),
			cc: addresses(detail.cc),
			date: detail.date,
			isUnread: detail.isUnread,
			isFlagged: detail.isFlagged,
			text: detail.content.text,
			html: detail.content.html,
			attachments: detail.content.attachments.enumerated().map { index, file in
				EmailAttachment(id: index, filename: file.filename, mimeType: file.mimeType, data: file.data)
			},
			webmailURL: detail.webmailURL.flatMap(URL.init(string:))
		)
	}
}
