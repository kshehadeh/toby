import Foundation
import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector
import WebKit

private let reference = EmailReference(uid: 42)

private func email(
	text: String = "", html: String = "", isUnread: Bool = true, attachments: [EmailAttachment] = []
) -> EmailMessage {
	EmailMessage(
		reference: reference, subject: "Contract review",
		from: [EmailAddress(name: "Alex Doe", email: "alex@example.com")],
		to: [EmailAddress(name: nil, email: "me@example.com")], cc: [EmailAddress(name: "Sam", email: "sam@example.com")],
		date: Date(timeIntervalSince1970: 1_790_000_000), isUnread: isUnread, isFlagged: false,
		text: text, html: html, attachments: attachments, webmailURL: nil
	)
}

private func feedItem(category: String = "email", provider: String = "email", itemId: String = "42:INBOX") -> FeedItem {
	FeedItem(
		id: "\(category):\(provider):\(itemId)",
		source: FeedItemSource(category: category, providerName: provider, itemId: itemId),
		tier: .today, title: "Contract review", subtitle: "Alex Doe <alex@example.com>", reason: "Needs a reply.",
		timestamp: "2026-11-16T14:00:00Z",
		actions: [
			FeedAction(id: "email.draftReply", label: "Draft a reply", kind: .chat, prompt: "Draft"),
			FeedAction(id: "dismiss", label: "Dismiss", kind: .local),
		]
	)
}

@MainActor
private func loadedStore(_ message: EmailMessage) async -> EmailReaderStore {
	let store = EmailReaderStore(request: EmailReaderRequest(reference: reference), fetch: { _ in message })
	await store.load()
	return store
}

@MainActor
@Suite("Email reader")
struct EmailReaderTests {
	@Test("only mail items map to a message")
	func references() {
		#expect(feedItem().emailReference == EmailReference(uid: 42, mailbox: "INBOX"))
		#expect(feedItem(itemId: "7:Lists/A:B").emailReference == EmailReference(uid: 7, mailbox: "Lists/A:B"))
		#expect(feedItem(itemId: "42").emailReference == EmailReference(uid: 42, mailbox: "INBOX"))
		#expect(feedItem(itemId: "abc").emailReference == nil)
		#expect(feedItem(category: "chat", provider: "slack").emailReference == nil)
		#expect(EmailReaderRequest(feedItem: feedItem(category: "tasks")) == nil)
	}

	@Test("header shows what the Feed knows until the message loads")
	func headerBeforeLoad() throws {
		let request = try #require(EmailReaderRequest(feedItem: feedItem()))
		let store = EmailReaderStore(request: request, fetch: { _ in email() })
		#expect(store.subject == "Contract review")
		#expect(store.sender == EmailAddress(name: "Alex Doe", email: "alex@example.com"))
		#expect(store.date != nil)
		#expect(store.sender?.initials == "AD")
		#expect(EmailReaderStore.parseSender("news@shop.com").initials == "N")
	}

	@Test("load adopts the message and the full set of actions")
	func loads() async throws {
		let request = try #require(EmailReaderRequest(feedItem: feedItem()))
		var requested: [String] = []
		let store = EmailReaderStore(
			request: request,
			fetch: { _ in email(text: "Hi", isUnread: false) },
			fetchActions: { id in
				requested.append(id)
				return feedItem().actions + [
					FeedAction(id: "email.archive", label: "Archive", kind: .tool),
					FeedAction(id: "email.markRead", label: "Mark read", kind: .tool),
				]
			}
		)
		await store.load()
		#expect(requested == ["email:email:42:INBOX"])
		#expect(store.message?.text == "Hi")
		#expect(store.action("email.archive") != nil)
		#expect(store.action("email.markRead") == nil, "already read")
		#expect(store.menuActions.map(\.id) == ["dismiss"])
	}

	@Test("a failed action lookup keeps the row's actions")
	func actionFallback() async throws {
		struct Gone: Error {}
		let request = try #require(EmailReaderRequest(feedItem: feedItem()))
		let store = EmailReaderStore(request: request, fetch: { _ in email(text: "Hi") }, fetchActions: { _ in throw Gone() })
		await store.load()
		#expect(store.action("email.draftReply") != nil)
	}

	@Test("a failed load explains why and can be retried")
	func retry() async throws {
		struct Offline: LocalizedError { var errorDescription: String? { "The mail server is offline." } }
		@MainActor final class Server { var isDown = true }
		let server = Server()
		let store = EmailReaderStore(request: EmailReaderRequest(reference: reference), fetch: { _ in
			if server.isDown { throw Offline() }
			return email(text: "Back")
		})
		await store.load()
		#expect(store.phase == .failed("The mail server is offline."))
		server.isDown = false
		await store.load()
		#expect(store.message?.text == "Back")
	}

	@Test("plain text shows as text; blocked images offer to load")
	func bodies() async throws {
		let plain = EmailReaderBody(store: await loadedStore(email(text: "See https://example.com")))
		#expect(throws: Never.self) { try plain.inspect().find(text: "See https://example.com") }

		let store = await loadedStore(email(html: "<img src=\"https://t.example.com/p.gif\">"))
		#expect(store.hasRemoteContent)
		try EmailReaderBody(store: store).inspect().find(button: "Load images").tap()
		#expect(store.allowsRemoteContent)

		let local = await loadedStore(email(html: "<img src=\"data:image/png;base64,QUE=\"><a href=\"https://example.com\">x</a>"))
		#expect(!local.hasRemoteContent, "links aren't remote content")
	}

	@Test("action bar offers reply, archive, mark read, the rest, and close")
	func actionBar() async throws {
		let request = try #require(EmailReaderRequest(feedItem: feedItem()))
		let store = EmailReaderStore(request: request, fetch: { _ in email(text: "Hi") }, fetchActions: { _ in
			feedItem().actions + [
				FeedAction(id: "email.archive", label: "Archive", kind: .tool),
				FeedAction(id: "email.markRead", label: "Mark read", kind: .tool),
			]
		})
		await store.load()
		var performed: [String] = []
		var closed = false
		let bar = EmailReaderActionBar(store: store, onAction: { performed.append($0.id) }, onClose: { closed = true })
		for label in ["Draft a reply", "Archive", "Mark read", "Dismiss", "Close"] {
			try bar.inspect().find(button: label).tap()
		}
		#expect(performed == ["email.draftReply", "email.archive", "email.markRead", "dismiss"])
		#expect(closed)
	}

	@Test("header lists people and attachments")
	func header() async throws {
		let file = EmailAttachment(id: 0, filename: "Quote.pdf", mimeType: "application/pdf", data: Data("PDF".utf8))
		let header = EmailReaderHeader(store: await loadedStore(email(attachments: [file])))
		for text in ["Contract review", "Alex Doe", "alex@example.com", "To: me@example.com", "Cc: Sam", "Quote.pdf"] {
			#expect(throws: Never.self, "\(text)") { try header.inspect().find(text: text) }
		}
	}

	@Test("attachment copies are quarantined and removed on close")
	func attachmentCopies() async throws {
		let files = [0, 1].map { EmailAttachment(id: $0, filename: "a.txt", mimeType: "text/plain", data: Data("\($0)".utf8)) }
		let store = await loadedStore(email(attachments: files))
		let urls = try files.map { try #require(store.previewURL(for: $0)) }
		#expect(urls[0] != urls[1])
		#expect(try Data(contentsOf: urls[1]) == Data("1".utf8))
		#expect(getxattr(urls[0].path, "com.apple.quarantine", nil, 0, 0, 0) > 0)
		store.close()
		#expect(!FileManager.default.fileExists(atPath: urls[0].path))
	}

	@Test("an unwritable save reports the error")
	func saveError() async throws {
		let file = EmailAttachment(id: 0, filename: "a.txt", mimeType: "text/plain", data: Data())
		let store = await loadedStore(email(attachments: [file]))
		store.save(file, to: URL(fileURLWithPath: "/nonexistent-\(UUID().uuidString)/a.txt"))
		#expect(store.attachmentError?.hasPrefix("Couldn't save a.txt") == true)
	}

	@Test("Feed email rows open the reader; other rows don't offer it")
	func feedRow() async throws {
		let item = feedItem()
		var opened = 0
		let row = FeedItemRow(item: item, onViewEmail: { opened += 1 }, onPerform: { _ in })
		try row.inspect().find(button: "View email").tap()
		try row.inspect().find(button: "Contract review").tap()
		#expect(opened == 2)

		let task = FeedItemRow(item: feedItem(category: "tasks", provider: "applereminders"), onPerform: { _ in })
		#expect(throws: (any Error).self) { try task.inspect().find(button: "View email") }

		let store = FeedStore { _ in FeedContent(status: .ok, items: [item], generatedAt: "2026-11-16T15:00:00Z") }
		await store.update(force: false)
		var viewed: [String] = []
		let card = FeedCardBody(store: store, onViewEmail: { viewed.append($0.id) })
		try card.inspect().find(button: "View email").tap()
		#expect(viewed == [item.id])
	}
}

@MainActor
@Suite("Email document")
struct EmailDocumentTests {
	@Test("detects remote images, styles, and backgrounds")
	func remoteContent() {
		for html in [
			"<img src='http://x.com/a.png'>", "<IMG SRC=https://x.com/a.png>", "<img srcset=\"//x.com/a.png 2x\">",
			"<td background=\"https://x.com/b.png\">", "<div style=\"background:url( 'https://x.com/b.png')\">",
			"<link rel=stylesheet href=\"https://x.com/a.css\">",
		] {
			#expect(EmailDocument.hasRemoteContent(html), "\(html)")
		}
		#expect(!EmailDocument.hasRemoteContent("<a href=\"https://x.com\">https://x.com</a><img src=\"data:image/png;base64,AA\">"))
	}

	@Test("policy precedes the message and never allows scripts")
	func policy() throws {
		let page = EmailDocument.page(for: "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src *\"></head>", allowsRemoteContent: false)
		let ours = try #require(page.range(of: "default-src 'none'"))
		let theirs = try #require(page.range(of: "default-src *"))
		#expect(ours.lowerBound < theirs.lowerBound)
		for allowed in [true, false] {
			#expect(EmailDocument.contentSecurityPolicy(allowsRemoteContent: allowed).contains("script-src 'none'"))
		}
		#expect(!EmailDocument.contentSecurityPolicy(allowsRemoteContent: false).contains("http"))
	}

	@Test("only web and mail links leave the reader")
	func links() {
		#expect(EmailDocument.externalURL(URL(string: "https://x.com")) != nil)
		#expect(EmailDocument.externalURL(URL(string: "mailto:a@x.com")) != nil)
		for raw in ["file:///etc/passwd", "javascript:alert(1)", "toby://run", "x-apple.systempreferences:"] {
			#expect(EmailDocument.externalURL(URL(string: raw)) == nil, "\(raw)")
		}
		let linked = EmailDocument.linkedText("Go to https://x.com now")
		#expect(linked.runs.compactMap(\.link).map(\.absoluteString) == ["https://x.com"])
		#expect(String(linked.characters) == "Go to https://x.com now")
	}
}
