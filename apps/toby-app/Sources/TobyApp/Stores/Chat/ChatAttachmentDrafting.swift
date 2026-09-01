import Foundation
import UniformTypeIdentifiers

/// Pure-ish helpers for draft chat attachments (validation, MIME types, transcript
/// preview mapping). `ChatStore` owns pending state and surfaces toasts.
enum ChatAttachmentDrafting {
	struct ToastMessage: Equatable {
		let title: String
		let message: String
	}

	struct AddOutcome: Equatable {
		var pendingAttachments: [ChatAttachmentDraft]
		var toasts: [ToastMessage]
	}

	/// Appends files to `pending`, applying capability limits. Collects user-facing
	/// toast messages instead of mutating UI state directly.
	static func adding(
		urls: [URL],
		to pending: [ChatAttachmentDraft],
		capability: ChatAttachmentCapability?,
		canAttach: Bool,
		unavailableReason: String,
		allowAnyMediaType: Bool = false,
		pdfOnly: Bool = false,
	) -> AddOutcome {
		guard canAttach else {
			return AddOutcome(
				pendingAttachments: pending,
				toasts: [ToastMessage(title: "Attachments unavailable", message: unavailableReason)],
			)
		}

		var next = pending
		var toasts: [ToastMessage] = []

		for url in urls {
			if let maxFiles = capability?.maxFiles, next.count >= maxFiles {
				toasts.append(
					ToastMessage(
						title: "Attachment error",
						message: "Too many attachments. Maximum is \(maxFiles).",
					),
				)
				break
			}
			do {
				let attachment = try makeDraft(from: url)
				if let maxBytes = capability?.maxBytesPerFile, attachment.byteSize > maxBytes {
					toasts.append(
						ToastMessage(
							title: "Attachment error",
							message: "\(attachment.filename) is too large.",
						),
					)
					continue
				}
				let totalBytes = next.reduce(0) { $0 + $1.byteSize } + attachment.byteSize
				if let maxTotal = capability?.maxTotalBytes, totalBytes > maxTotal {
					toasts.append(
						ToastMessage(title: "Attachment error", message: "Attachments are too large."),
					)
					continue
				}
				if pdfOnly, attachment.mediaType != "application/pdf" {
					toasts.append(
						ToastMessage(
							title: "Attachment error",
							message: "This model can only read PDFs as text. Attach a PDF, or switch to a model that supports files.",
						),
					)
					continue
				}
				if !allowAnyMediaType,
					!pdfOnly,
					let accepted = capability?.acceptedMediaTypes,
					!accepted.isEmpty,
					!accepted.contains(attachment.mediaType)
				{
					toasts.append(
						ToastMessage(
							title: "Attachment error",
							message: "Unsupported attachment type: \(attachment.mediaType).",
						),
					)
					continue
				}
				next.append(attachment)
			} catch {
				toasts.append(
					ToastMessage(title: "Attachment error", message: error.localizedDescription),
				)
			}
		}

		return AddOutcome(pendingAttachments: next, toasts: toasts)
	}

	static func makeDraft(from url: URL) throws -> ChatAttachmentDraft {
		let didAccess = url.startAccessingSecurityScopedResource()
		defer {
			if didAccess {
				url.stopAccessingSecurityScopedResource()
			}
		}
		let data = try Data(contentsOf: url)
		let mediaType = mediaType(for: url)
		return ChatAttachmentDraft(
			filename: url.lastPathComponent,
			mediaType: mediaType,
			dataBase64: data.base64EncodedString(),
			byteSize: data.count,
		)
	}

	static func mediaType(for url: URL) -> String {
		if let type = UTType(filenameExtension: url.pathExtension),
			let mimeType = type.preferredMIMEType
		{
			switch mimeType {
			case "application/x-javascript":
				return "text/javascript"
			default:
				return mimeType
			}
		}
		switch url.pathExtension.lowercased() {
		case "md", "markdown": return "text/markdown"
		case "ts", "tsx": return "application/typescript"
		case "js", "jsx", "mjs", "cjs": return "text/javascript"
		case "json": return "application/json"
		case "csv": return "text/csv"
		case "xml": return "application/xml"
		case "html", "htm": return "text/html"
		case "css": return "text/css"
		case "rtf": return "application/rtf"
		default: return "text/plain"
		}
	}

	static func userTranscriptText(text: String, attachments: [ChatAttachmentDraft]) -> String {
		guard !attachments.isEmpty else { return text }
		let names = attachments.map { "\($0.filename) (\($0.mediaType), \($0.byteSize) bytes)" }
			.joined(separator: ", ")
		if text.isEmpty {
			return "Attachments: \(names)"
		}
		return "\(text)\n\nAttachments: \(names)"
	}

	static func transcriptAttachments(from attachments: [ChatAttachmentDraft]) -> [ChatTranscriptAttachment] {
		attachments.map {
			ChatTranscriptAttachment(
				id: $0.id,
				filename: $0.filename,
				mediaType: $0.mediaType,
				dataBase64: $0.dataBase64,
				byteSize: $0.byteSize,
			)
		}
	}

	/// Re-applies local attachment previews after a server transcript reload that
	/// returns user rows without attachment payloads.
	static func rehydrateLocalPreviews(
		in entries: [TranscriptEntry],
		previewsByTranscriptText: [String: [ChatTranscriptAttachment]],
	) -> [TranscriptEntry] {
		entries.map { entry in
			guard case .user(let text, let attachments) = entry, attachments.isEmpty,
				let localAttachments = previewsByTranscriptText[text]
			else {
				return entry
			}
			return .user(text: text, attachments: localAttachments)
		}
	}
}
