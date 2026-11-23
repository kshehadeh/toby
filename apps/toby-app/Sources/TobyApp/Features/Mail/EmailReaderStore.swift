import Foundation
import Observation

/// What to open in the reader, plus what's already known about the message so
/// the header shows before the mailbox answers.
struct EmailReaderRequest: Identifiable, Equatable, Sendable {
	let reference: EmailReference
	var subject: String = ""
	/// Sender as the source wrote it, e.g. `Ana <ana@x.com>`.
	var sender: String?
	var date: Date?
	/// The Feed item this came from; its actions show in the reader.
	var feedItem: FeedItem?

	var id: EmailReference { reference }

	init(reference: EmailReference, subject: String = "", sender: String? = nil, date: Date? = nil, feedItem: FeedItem? = nil) {
		self.reference = reference
		self.subject = subject
		self.sender = sender
		self.date = date
		self.feedItem = feedItem
	}

	/// Nil when the item isn't a message in the connected mailbox.
	init?(feedItem: FeedItem) {
		guard let reference = feedItem.emailReference else { return nil }
		self.init(
			reference: reference, subject: feedItem.title, sender: feedItem.subtitle,
			date: DashboardDate.parse(feedItem.timestamp), feedItem: feedItem
		)
	}
}

/// Loads one message for the email reader.
@Observable
@MainActor
final class EmailReaderStore {
	enum Phase: Equatable {
		case loading
		case loaded(EmailMessage)
		case failed(String)
	}

	let request: EmailReaderRequest
	private(set) var phase: Phase = .loading
	/// Actions the message supports; starts with the Feed row's own.
	private(set) var actions: [FeedAction]
	/// Set by "Load images" for this message only.
	var allowsRemoteContent = false
	private(set) var hasRemoteContent = false
	private(set) var attachmentError: String?

	@ObservationIgnored private let fetch: @MainActor (EmailReference) async throws -> EmailMessage
	@ObservationIgnored private let fetchActions: @MainActor (String) async throws -> [FeedAction]
	/// Holds Quick Look copies of attachments while the reader is open.
	@ObservationIgnored private var previewFolder: URL?

	init(request: EmailReaderRequest, client: TobyClient = TobyClient()) {
		self.request = request
		self.actions = request.feedItem?.actions ?? []
		self.fetch = { try await client.fetchEmail($0) }
		self.fetchActions = { try await client.fetchFeedItemActions(itemID: $0) }
	}

	/// Test seam.
	init(
		request: EmailReaderRequest,
		fetch: @escaping @MainActor (EmailReference) async throws -> EmailMessage,
		fetchActions: @escaping @MainActor (String) async throws -> [FeedAction] = { _ in [] }
	) {
		self.request = request
		self.actions = request.feedItem?.actions ?? []
		self.fetch = fetch
		self.fetchActions = fetchActions
	}

	var message: EmailMessage? {
		if case .loaded(let message) = phase { return message }
		return nil
	}

	// MARK: Header

	var subject: String {
		let text = (message?.subject ?? request.subject).trimmingCharacters(in: .whitespacesAndNewlines)
		return text.isEmpty ? "(no subject)" : text
	}

	var sender: EmailAddress? {
		if let first = message?.from.first { return first }
		return request.sender.map(Self.parseSender)
	}

	var date: Date? { message?.date ?? request.date }

	/// `Ana <ana@x.com>` or a bare address.
	static func parseSender(_ raw: String) -> EmailAddress {
		guard let open = raw.lastIndex(of: "<"), raw.hasSuffix(">") else { return EmailAddress(name: nil, email: raw) }
		let name = raw[..<open].trimmingCharacters(in: CharacterSet(charactersIn: " \""))
		return EmailAddress(name: name.isEmpty ? nil : name, email: String(raw[raw.index(after: open)...].dropLast()))
	}

	// MARK: Actions

	func action(_ id: String) -> FeedAction? {
		// Nothing to mark once the server says it's read.
		if id == FeedAction.markReadID, message?.isUnread == false { return nil }
		return actions.first { $0.id == id }
	}

	/// Everything that isn't its own toolbar button.
	var menuActions: [FeedAction] {
		actions.filter { ![FeedAction.draftReplyID, FeedAction.archiveID, FeedAction.markReadID].contains($0.id) && $0.kind != .open }
	}

	// MARK: Loading

	func load() async {
		phase = .loading
		async let extra = loadActions()
		do {
			let message = try await fetch(request.reference)
			hasRemoteContent = EmailDocument.hasRemoteContent(message.html)
			phase = .loaded(message)
		} catch {
			// Closing the sheet cancels the load; leave the state for a retry.
			if !Task.isCancelled { phase = .failed(error.localizedDescription) }
		}
		await extra
	}

	/// The row's own actions still work when this fails.
	private func loadActions() async {
		guard let item = request.feedItem, let loaded = try? await fetchActions(item.id), !loaded.isEmpty else { return }
		actions = loaded
	}

	// MARK: Attachments

	/// Writes a Quick Look copy; nil (with `attachmentError` set) on failure.
	func previewURL(for attachment: EmailAttachment) -> URL? {
		do {
			let folder = try previewFolder ?? Self.makePreviewFolder()
			previewFolder = folder
			// One folder per attachment so equal names don't collide.
			let directory = folder.appending(path: "\(attachment.id)")
			try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
			let url = directory.appending(path: attachment.filename)
			try Self.write(attachment, to: url)
			attachmentError = nil
			return url
		} catch {
			attachmentError = "Couldn't open \(attachment.filename): \(error.localizedDescription)"
			return nil
		}
	}

	func save(_ attachment: EmailAttachment, to url: URL) {
		do {
			try Self.write(attachment, to: url)
			attachmentError = nil
		} catch {
			attachmentError = "Couldn't save \(attachment.filename): \(error.localizedDescription)"
		}
	}

	/// Deletes Quick Look copies.
	func close() {
		if let previewFolder { try? FileManager.default.removeItem(at: previewFolder) }
		previewFolder = nil
	}

	private static func makePreviewFolder() throws -> URL {
		let url = FileManager.default.temporaryDirectory.appending(path: "toby-mail-\(UUID().uuidString)")
		try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
		return url
	}

	/// Marks the file as an email attachment so Gatekeeper checks it on open.
	private static func write(_ attachment: EmailAttachment, to url: URL) throws {
		try attachment.data.write(to: url, options: .atomic)
		var target = url
		var values = URLResourceValues()
		values.quarantineProperties = [
			kLSQuarantineTypeKey as String: kLSQuarantineTypeEmailAttachment as String,
			kLSQuarantineAgentNameKey as String: "Toby",
		]
		try target.setResourceValues(values)
	}
}
