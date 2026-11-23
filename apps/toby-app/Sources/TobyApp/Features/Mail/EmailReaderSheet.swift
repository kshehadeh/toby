import AppKit
import SwiftUI

/// Reads one email: subject, people, attachments, and the original message.
struct EmailReaderSheet: View {
	@State private var store: EmailReaderStore
	/// Runs a Feed action; the presenter closes the reader.
	let onAction: (FeedAction) -> Void
	let onClose: () -> Void

	init(store: EmailReaderStore, onAction: @escaping (FeedAction) -> Void = { _ in }, onClose: @escaping () -> Void) {
		_store = State(initialValue: store)
		self.onAction = onAction
		self.onClose = onClose
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			EmailReaderActionBar(store: store, onAction: onAction, onClose: onClose)
				.padding(.horizontal, 24)
				.padding(.vertical, 12)
			Divider()
			EmailReaderHeader(store: store)
				.padding(.horizontal, 24)
				.padding(.vertical, 16)
			Divider()
			EmailReaderBody(store: store)
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.background(AppTheme.contentBackground)
		// Sheets open at their minimum; newsletters are laid out 600pt wide.
		.frame(minWidth: 720, idealWidth: 780, minHeight: 560, idealHeight: 720)
		.task { await store.load() }
		.onDisappear { store.close() }
		.accessibilityIdentifier("email-reader")
	}
}

/// Reply, archive, mark read, everything else, and Close. In the content
/// because a sheet's toolbar shows only its first primary action.
struct EmailReaderActionBar: View {
	let store: EmailReaderStore
	let onAction: (FeedAction) -> Void
	let onClose: () -> Void

	/// Symbols differ in height; one label height keeps the buttons even.
	private static let labelHeight: CGFloat = 16

	var body: some View {
		HStack(spacing: 8) {
			if let reply = store.action(FeedAction.draftReplyID) {
				actionButton(reply, systemImage: "arrowshape.turn.up.left")
					.help("Draft a reply in chat")
			}
			if let archive = store.action(FeedAction.archiveID) {
				actionButton(archive, systemImage: "archivebox")
			}
			if let markRead = store.action(FeedAction.markReadID) {
				actionButton(markRead, systemImage: "envelope.open")
			}
			if !store.menuActions.isEmpty || store.message?.webmailURL != nil {
				moreMenu
			}
			Spacer(minLength: 8)
			Button(action: onClose) {
				Text("Close").frame(height: Self.labelHeight)
			}
			.keyboardShortcut(.cancelAction)
			.accessibilityIdentifier("email-reader-close")
		}
	}

	private func actionButton(_ action: FeedAction, systemImage: String) -> some View {
		Button {
			onAction(action)
		} label: {
			Label(action.label, systemImage: systemImage)
				.frame(height: Self.labelHeight)
		}
		.buttonStyle(.bordered)
		.accessibilityIdentifier("email-reader-\(action.id)")
	}

	private var moreMenu: some View {
		Menu {
			ForEach(store.menuActions) { action in
				Button(action.label) { onAction(action) }
			}
			if let url = store.message?.webmailURL {
				if !store.menuActions.isEmpty { Divider() }
				Button("Open webmail") { NSWorkspace.shared.open(url) }
			}
		} label: {
			Image(systemName: "ellipsis")
				.frame(height: Self.labelHeight)
		}
		.menuStyle(.button)
		.buttonStyle(.bordered)
		.menuIndicator(.hidden)
		.fixedSize()
		.help("More actions")
		.accessibilityLabel("More actions")
	}
}

/// Subject, sender, recipients, date, and attachments.
struct EmailReaderHeader: View {
	let store: EmailReaderStore

	var body: some View {
		VStack(alignment: .leading, spacing: 12) {
			Text(store.subject)
				.font(.title2.weight(.semibold))
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(3)
				.textSelection(.enabled)
				.accessibilityAddTraits(.isHeader)
				.accessibilityIdentifier("email-reader-subject")
			HStack(alignment: .top, spacing: 12) {
				if let sender = store.sender {
					senderBadge(sender)
				}
				VStack(alignment: .leading, spacing: 3) {
					HStack(alignment: .firstTextBaseline, spacing: 8) {
						senderName
						Spacer(minLength: 8)
						if let date = store.date {
							Text(date.formatted(date: .abbreviated, time: .shortened))
								.font(.system(size: 12))
								.foregroundStyle(AppTheme.tertiaryText)
								.lineLimit(1)
								.fixedSize()
						}
					}
					if let message = store.message {
						recipients("To", message.to)
						recipients("Cc", message.cc)
					}
				}
			}
			if let attachments = store.message?.attachments, !attachments.isEmpty {
				EmailAttachmentStrip(store: store, attachments: attachments)
			}
			if let error = store.attachmentError {
				InlineStatusMessage(message: error, tone: .error, font: .caption)
			}
		}
	}

	private func senderBadge(_ sender: EmailAddress) -> some View {
		Text(sender.initials)
			.font(.system(size: 13, weight: .semibold))
			.foregroundStyle(AppTheme.secondaryText)
			.frame(width: 36, height: 36)
			.background(AppTheme.panelBackground, in: Circle())
			.accessibilityHidden(true)
	}

	private var senderName: some View {
		HStack(alignment: .firstTextBaseline, spacing: 6) {
			if let sender = store.sender {
				Text(sender.displayName)
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(AppTheme.primaryText)
					.layoutPriority(1)
				if sender.displayName != sender.email {
					Text(sender.email)
						.font(.system(size: 12))
						.foregroundStyle(AppTheme.tertiaryText)
				}
			} else if store.message != nil {
				Text("Unknown sender")
					.font(.system(size: 13, weight: .semibold))
					.foregroundStyle(AppTheme.secondaryText)
			}
			if store.message?.isUnread == true {
				Text("Unread")
					.font(.system(size: 11))
					.foregroundStyle(AppTheme.tertiaryText)
			}
			if store.message?.isFlagged == true {
				Image(systemName: "flag.fill")
					.font(.system(size: 10))
					.foregroundStyle(AppTheme.secondaryText)
					.accessibilityLabel("Flagged")
			}
		}
		.lineLimit(1)
		.truncationMode(.tail)
		.textSelection(.enabled)
	}

	@ViewBuilder
	private func recipients(_ label: String, _ people: [EmailAddress]) -> some View {
		if !people.isEmpty {
			Text("\(label): \(people.map(\.displayName).joined(separator: ", "))")
				.font(.system(size: 12))
				.foregroundStyle(AppTheme.secondaryText)
				.lineLimit(2)
				.help(people.map(\.email).joined(separator: "\n"))
				.textSelection(.enabled)
		}
	}
}

/// Attachment chips: click to preview, or save a copy.
struct EmailAttachmentStrip: View {
	let store: EmailReaderStore
	let attachments: [EmailAttachment]

	var body: some View {
		ScrollView(.horizontal) {
			HStack(spacing: 8) {
				ForEach(attachments) { attachment in
					chip(attachment)
				}
			}
		}
		.scrollIndicators(.never)
		.accessibilityIdentifier("email-reader-attachments")
	}

	private func chip(_ attachment: EmailAttachment) -> some View {
		HStack(spacing: 8) {
			Button {
				if let url = store.previewURL(for: attachment) { FileQuickLook.present(path: url.path) }
			} label: {
				HStack(spacing: 6) {
					Image(systemName: attachment.systemImage)
						.foregroundStyle(AppTheme.secondaryText)
						.accessibilityHidden(true)
					Text(attachment.filename)
						.foregroundStyle(AppTheme.primaryText)
						.lineLimit(1)
						.truncationMode(.middle)
						.frame(maxWidth: 200)
						.fixedSize(horizontal: true, vertical: false)
					Text(attachment.sizeText)
						.foregroundStyle(AppTheme.tertiaryText)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.help("Preview \(attachment.filename)")
			.accessibilityLabel("Preview \(attachment.filename), \(attachment.sizeText)")
			Button {
				save(attachment)
			} label: {
				Image(systemName: "arrow.down.circle")
					.foregroundStyle(AppTheme.secondaryText)
					.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.help("Save \(attachment.filename)…")
			.accessibilityLabel("Save \(attachment.filename)")
		}
		.font(.system(size: 12))
		.padding(.horizontal, 10)
		.padding(.vertical, 6)
		.background(AppTheme.panelBackground, in: RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius))
	}

	private func save(_ attachment: EmailAttachment) {
		let panel = NSSavePanel()
		panel.canCreateDirectories = true
		panel.isExtensionHidden = false
		panel.nameFieldStringValue = attachment.filename
		guard panel.runModal() == .OK, let url = panel.url else { return }
		store.save(attachment, to: url)
	}
}

/// The message itself, or its loading / failed state.
struct EmailReaderBody: View {
	@Bindable var store: EmailReaderStore

	var body: some View {
		switch store.phase {
		case .loading:
			ProgressView("Loading message…")
				.controlSize(.small)
		case .failed(let message):
			ContentUnavailableView {
				Label("Couldn't open this email", systemImage: "exclamationmark.triangle")
			} description: {
				Text(message)
			} actions: {
				Button("Try again") { Task { await store.load() } }
					.accessibilityIdentifier("email-reader-retry")
			}
		case .loaded(let message):
			if !message.html.isEmpty {
				VStack(spacing: 0) {
					if store.hasRemoteContent, !store.allowsRemoteContent {
						remoteContentBanner
						Divider()
					}
					EmailHTMLView(html: message.html, allowsRemoteContent: store.allowsRemoteContent)
				}
			} else if !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				plainText(message.text)
			} else {
				ContentUnavailableView(
					"No message text", systemImage: "envelope.open",
					description: Text(message.attachments.isEmpty ? "This email is empty." : "This email only has attachments.")
				)
			}
		}
	}

	private var remoteContentBanner: some View {
		HStack(spacing: 8) {
			Image(systemName: "eye.slash")
				.foregroundStyle(AppTheme.secondaryText)
				.accessibilityHidden(true)
			Text("Remote images are blocked so the sender can't tell you opened this.")
				.foregroundStyle(AppTheme.secondaryText)
				.lineLimit(2)
			Spacer(minLength: 8)
			Button("Load images") { store.allowsRemoteContent = true }
				.controlSize(.small)
				.accessibilityIdentifier("email-reader-load-images")
		}
		.font(.system(size: 12))
		.padding(.horizontal, 24)
		.padding(.vertical, 8)
		.background(AppTheme.panelBackground)
	}

	private func plainText(_ text: String) -> some View {
		ScrollView {
			Text(EmailDocument.linkedText(text))
				.font(.system(size: 14))
				.foregroundStyle(AppTheme.primaryText)
				.lineSpacing(4)
				.textSelection(.enabled)
				.frame(maxWidth: AppTheme.transcriptReadingWidth, alignment: .leading)
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(24)
		}
	}
}
