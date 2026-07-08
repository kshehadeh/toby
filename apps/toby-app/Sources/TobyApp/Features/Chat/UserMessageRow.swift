import AppKit
import SwiftUI

struct UserMessageRow: View {
	let text: String
	let attachments: [ChatTranscriptAttachment]
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

	init(text: String, attachments: [ChatTranscriptAttachment] = []) {
		self.text = text
		self.attachments = attachments
	}

	var body: some View {
		HStack(alignment: .top, spacing: 0) {
			Spacer(minLength: 0)
			VStack(alignment: .trailing, spacing: 6) {
				if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
					Text(displayedText)
						.font(AppTheme.transcriptBodyFont)
						.tracking(AppTheme.transcriptTracking)
						.lineSpacing(AppTheme.transcriptLineSpacing)
						.foregroundStyle(AppTheme.primaryText)
						.textSelection(.enabled)
						.fixedSize(horizontal: false, vertical: true)
						.padding(.horizontal, 16)
						.padding(.vertical, 12)
						.background(
							RoundedRectangle(cornerRadius: 14, style: .continuous)
								.fill(AppTheme.elevatedBackground.opacity(0.92))
						)
						.overlay(
							RoundedRectangle(cornerRadius: 14, style: .continuous)
								.stroke(AppTheme.separator)
						)
						.overlay(alignment: .leading) {
							RoundedRectangle(cornerRadius: 14, style: .continuous)
								.fill(AppTheme.accent)
								.mask(alignment: .leading) {
									Rectangle()
										.frame(width: 4)
								}
						}
						.frame(maxWidth: 520, alignment: .trailing)
				}
				if !attachments.isEmpty {
					TranscriptAttachmentPreviewList(attachments: attachments)
						.frame(maxWidth: 520, alignment: .trailing)
				}
				if isLargePrompt {
					Button(action: {
						withAnimation(.easeOut(duration: 0.2)) {
							isExpanded.toggle()
						}
					}) {
						Text(isExpanded ? "Show less" : "Show more")
							.font(AppTheme.transcriptCaptionFont)
							.tracking(AppTheme.transcriptTracking)
							.foregroundStyle(AppTheme.accent)
					}
					.buttonStyle(.plain)
					.padding(.top, 2)
				}
				if isCopyable {
					CopyButton(text: text, label: "Copy prompt")
						.padding(.top, 2)
				}
			}
		}
	}
}

private struct TranscriptAttachmentPreviewList: View {
	let attachments: [ChatTranscriptAttachment]

	var body: some View {
		VStack(alignment: .trailing, spacing: 8) {
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
				.clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
				.accessibilityLabel("Image attachment \(attachment.filename)")
			TranscriptAttachmentCaption(attachment: attachment)
		}
		.padding(8)
		.background(
			RoundedRectangle(cornerRadius: 14, style: .continuous)
				.fill(AppTheme.elevatedBackground.opacity(0.92))
		)
		.overlay(
			RoundedRectangle(cornerRadius: 14, style: .continuous)
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
			RoundedRectangle(cornerRadius: 10, style: .continuous)
				.fill(AppTheme.elevatedBackground.opacity(0.92))
		)
		.overlay(
			RoundedRectangle(cornerRadius: 10, style: .continuous)
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
				.tracking(AppTheme.transcriptTracking)
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(1)
				.truncationMode(.middle)
			Text(formatAttachmentByteSize(attachment.byteSize))
				.font(AppTheme.transcriptCaptionFont)
				.tracking(AppTheme.transcriptTracking)
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
