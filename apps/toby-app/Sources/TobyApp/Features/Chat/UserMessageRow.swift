import AppKit
import SwiftUI

struct UserMessageRow: View {
	let text: String
	let attachments: [ChatTranscriptAttachment]
	var createdAt: String? = nil
	private static let collapsedLineLimit = 12
	private var isCopyable: Bool {
		!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}

	@State private var isExpanded = false

	private var isLargePrompt: Bool {
		text.components(separatedBy: "\n").count > Self.collapsedLineLimit
	}

	private var displayedText: String {
		guard isLargePrompt, !isExpanded else { return text }
		let lines = text.components(separatedBy: "\n")
		return lines.prefix(Self.collapsedLineLimit).joined(separator: "\n").trimmingCharacters(in: .newlines) + "…"
	}

	init(
		text: String,
		attachments: [ChatTranscriptAttachment] = [],
		createdAt: String? = nil
	) {
		self.text = text
		self.attachments = attachments
		self.createdAt = createdAt
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				Text(displayedText)
					.font(AppTheme.transcriptAnswerFont)
					.foregroundStyle(AppTheme.primaryText)
					.textSelection(.enabled)
					.fixedSize(horizontal: false, vertical: true)
					.padding(.horizontal, 16)
					.padding(.vertical, 12)
					.background(
						AppTheme.concentricRect(minimum: 14)
							.fill(AppTheme.elevatedBackground.opacity(0.92))
					)
					.overlay(
						AppTheme.concentricRect(minimum: 14)
							.stroke(AppTheme.separator)
					)
					.frame(maxWidth: AppTheme.transcriptReadingWidth, alignment: .leading)
			}
			if !attachments.isEmpty {
				TranscriptAttachmentPreviewList(attachments: attachments)
					.frame(maxWidth: AppTheme.transcriptReadingWidth, alignment: .leading)
			}
			if isLargePrompt {
				Button(action: {
					withAnimation(.easeOut(duration: 0.2)) {
						isExpanded.toggle()
					}
				}) {
					Text(isExpanded ? "Show less" : "Show more")
						.font(AppTheme.transcriptCaptionFont)
						.foregroundStyle(AppTheme.accent)
				}
				.buttonStyle(.plain)
				.padding(.top, 2)
			}
			if isCopyable {
				TranscriptMessageActions(
					copyText: text,
					copyLabel: "Copy prompt",
					createdAt: createdAt,
				)
			}
		}
		.frame(maxWidth: AppTheme.transcriptReadingWidth, alignment: .leading)
		.accessibilityIdentifier("user-message-row")
	}
}

private struct TranscriptAttachmentPreviewList: View {
	let attachments: [ChatTranscriptAttachment]

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			ForEach(attachments) { attachment in
				if attachment.isImagePreviewable, let image = attachment.previewImage {
					TranscriptImageAttachmentPreview(attachment: attachment, image: image)
				} else {
					TranscriptFileAttachmentChip(attachment: attachment)
				}
			}
		}
		.accessibilityIdentifier("chat-transcript-attachments")
	}
}

private struct TranscriptImageAttachmentPreview: View {
	let attachment: ChatTranscriptAttachment
	let image: NSImage

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			Image(nsImage: image)
				.resizable()
				.scaledToFit()
				.frame(maxWidth: 320, maxHeight: 240)
				.clipShape(AppTheme.concentricRect(minimum: 10))
				.accessibilityLabel("Image attachment \(attachment.filename)")
			TranscriptAttachmentCaption(attachment: attachment)
		}
		.padding(8)
		.background(
			AppTheme.concentricRect(minimum: 14)
				.fill(AppTheme.elevatedBackground.opacity(0.92))
		)
		.overlay(
			AppTheme.concentricRect(minimum: 14)
				.stroke(AppTheme.separator)
		)
		.accessibilityElement(children: .combine)
		.accessibilityIdentifier("chat-transcript-image-attachment")
	}
}

private struct TranscriptFileAttachmentChip: View {
	let attachment: ChatTranscriptAttachment

	var body: some View {
		HStack(spacing: 8) {
			Image(systemName: "paperclip")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(AppTheme.accent)
			TranscriptAttachmentCaption(attachment: attachment)
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 8)
		.background(
			AppTheme.concentricRect(minimum: 10)
				.fill(AppTheme.elevatedBackground.opacity(0.92))
		)
		.overlay(
			AppTheme.concentricRect(minimum: 10)
				.stroke(AppTheme.separator)
		)
		.accessibilityIdentifier("chat-transcript-file-attachment")
	}
}

private struct TranscriptAttachmentCaption: View {
	let attachment: ChatTranscriptAttachment

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			Text(attachment.filename)
				.font(AppTheme.transcriptCaptionFont)
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(1)
				.truncationMode(.middle)
			Text(formatAttachmentByteSize(attachment.byteSize))
				.font(AppTheme.transcriptCaptionFont)
				.foregroundStyle(AppTheme.secondaryText)
		}
	}
}

private extension ChatTranscriptAttachment {
	var previewImage: NSImage? {
		guard let data = Data(base64Encoded: dataBase64) else { return nil }
		return NSImage(data: data)
	}
}
