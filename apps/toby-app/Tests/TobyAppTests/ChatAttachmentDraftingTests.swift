import Foundation
import Testing
@testable import TobyApp

@Suite("ChatAttachmentDrafting")
struct ChatAttachmentDraftingTests {
	private func capability(
		supported: Bool = true,
		maxFiles: Int = 5,
		maxBytesPerFile: Int = 1_000_000,
		maxTotalBytes: Int = 5_000_000,
		acceptedMediaTypes: [String] = [],
	) -> ChatAttachmentCapability {
		ChatAttachmentCapability(
			supported: supported,
			reason: supported ? nil : "Model does not support files",
			acceptedMediaTypes: acceptedMediaTypes,
			maxFiles: maxFiles,
			maxBytesPerFile: maxBytesPerFile,
			maxTotalBytes: maxTotalBytes,
		)
	}

	@Test("mediaType maps markdown and typescript extensions")
	func mediaTypeMapsCommonExtensions() {
		#expect(ChatAttachmentDrafting.mediaType(for: URL(fileURLWithPath: "/tmp/note.md")) == "text/markdown")
		#expect(
			ChatAttachmentDrafting.mediaType(for: URL(fileURLWithPath: "/tmp/app.ts"))
				== "application/typescript"
		)
		#expect(ChatAttachmentDrafting.mediaType(for: URL(fileURLWithPath: "/tmp/data.json")) == "application/json")
	}

	@Test("userTranscriptText lists attachment metadata")
	func userTranscriptTextListsAttachments() {
		let draft = ChatAttachmentDraft(
			filename: "a.txt",
			mediaType: "text/plain",
			dataBase64: "YQ==",
			byteSize: 1,
		)
		#expect(
			ChatAttachmentDrafting.userTranscriptText(text: "hi", attachments: [draft])
				== "hi\n\nAttachments: a.txt (text/plain, 1 bytes)"
		)
		#expect(
			ChatAttachmentDrafting.userTranscriptText(text: "", attachments: [draft])
				== "Attachments: a.txt (text/plain, 1 bytes)"
		)
		#expect(ChatAttachmentDrafting.userTranscriptText(text: "only", attachments: []) == "only")
	}

	@Test("adding when canAttach is false returns unavailable toast")
	func addingWhenUnavailable() {
		let outcome = ChatAttachmentDrafting.adding(
			urls: [URL(fileURLWithPath: "/tmp/x.txt")],
			to: [],
			capability: capability(supported: false),
			canAttach: false,
			unavailableReason: "No files",
		)
		#expect(outcome.pendingAttachments.isEmpty)
		#expect(outcome.toasts == [
			ChatAttachmentDrafting.ToastMessage(title: "Attachments unavailable", message: "No files"),
		])
	}

	@Test("pdfOnly rejects non-PDF files")
	func pdfOnlyRejectsNonPdf() throws {
		let url = FileManager.default.temporaryDirectory
			.appendingPathComponent("chat-pdf-only-\(UUID().uuidString).txt")
		try "notes".write(to: url, atomically: true, encoding: .utf8)
		defer { try? FileManager.default.removeItem(at: url) }

		let outcome = ChatAttachmentDrafting.adding(
			urls: [url],
			to: [],
			capability: capability(supported: false, acceptedMediaTypes: ["application/pdf"]),
			canAttach: true,
			unavailableReason: "",
			pdfOnly: true,
		)
		#expect(outcome.pendingAttachments.isEmpty)
		#expect(outcome.toasts.count == 1)
		#expect(outcome.toasts[0].message.contains("only read PDFs"))
	}

	@Test("adding a project attachment allows files outside model limits")
	func addingProjectAttachmentAllowsAnyMediaType() throws {
		let url = FileManager.default.temporaryDirectory
			.appendingPathComponent("chat-project-attach-\(UUID().uuidString).zip")
		try "archive".write(to: url, atomically: true, encoding: .utf8)
		defer { try? FileManager.default.removeItem(at: url) }

		let outcome = ChatAttachmentDrafting.adding(
			urls: [url],
			to: [],
			capability: capability(supported: false, acceptedMediaTypes: ["text/plain"]),
			canAttach: true,
			unavailableReason: "",
			allowAnyMediaType: true,
		)
		#expect(outcome.pendingAttachments.count == 1)
		#expect(outcome.toasts.isEmpty)
	}

	@Test("adding enforces maxFiles")
	func addingEnforcesMaxFiles() throws {
		let dir = FileManager.default.temporaryDirectory
		let url1 = dir.appendingPathComponent("chat-attach-1-\(UUID().uuidString).txt")
		let url2 = dir.appendingPathComponent("chat-attach-2-\(UUID().uuidString).txt")
		try "one".write(to: url1, atomically: true, encoding: .utf8)
		try "two".write(to: url2, atomically: true, encoding: .utf8)
		defer {
			try? FileManager.default.removeItem(at: url1)
			try? FileManager.default.removeItem(at: url2)
		}

		let first = try ChatAttachmentDrafting.makeDraft(from: url1)
		let outcome = ChatAttachmentDrafting.adding(
			urls: [url2],
			to: [first],
			capability: capability(maxFiles: 1),
			canAttach: true,
			unavailableReason: "",
		)
		#expect(outcome.pendingAttachments.count == 1)
		#expect(outcome.toasts.count == 1)
		#expect(outcome.toasts[0].title == "Attachment error")
		#expect(outcome.toasts[0].message.contains("Too many attachments"))
	}

	@Test("rehydrateLocalPreviews restores empty user attachment arrays")
	func rehydrateRestoresPreviews() {
		let preview = ChatTranscriptAttachment(
			filename: "a.txt",
			mediaType: "text/plain",
			dataBase64: "YQ==",
			byteSize: 1,
		)
		let text = "hi\n\nAttachments: a.txt (text/plain, 1 bytes)"
		let entries: [TranscriptEntry] = [
			.user(text: text, attachments: []),
			.assistant(text: "ok"),
		]
		let restored = ChatAttachmentDrafting.rehydrateLocalPreviews(
			in: entries,
			previewsByTranscriptText: [text: [preview]],
		)
		#expect(restored.count == 2)
		guard case .user(_, let attachments) = restored[0] else {
			Issue.record("expected user entry")
			return
		}
		#expect(attachments.count == 1)
		#expect(attachments[0].filename == "a.txt")
	}
}
