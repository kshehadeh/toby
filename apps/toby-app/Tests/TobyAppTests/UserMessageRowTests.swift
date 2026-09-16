import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("UserMessageRow")
struct UserMessageRowTests {
	@Test("renders image attachment previews")
	func rendersImageAttachmentPreviews() throws {
		let attachment = ChatTranscriptAttachment(
			filename: "pixel.png",
			mediaType: "image/png",
			dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
			byteSize: 68
		)
		let view = UserMessageRow(text: "See attached", attachments: [attachment])

		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "chat-transcript-image-attachment")
		}
	}

	@Test("renders non-image attachments as file chips")
	func rendersFileAttachmentChips() throws {
		let attachment = ChatTranscriptAttachment(
			filename: "notes.txt",
			mediaType: "text/plain",
			dataBase64: "aGVsbG8=",
			byteSize: 5
		)
		let view = UserMessageRow(text: "", attachments: [attachment])

		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "chat-transcript-file-attachment")
		}
	}

	@Test("shows copy actions for a prompt")
	func showsCopyActions() throws {
		let view = UserMessageRow(text: "See attached", createdAt: "2026-09-16T12:00:00Z")
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "user-message-row")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "transcript-message-actions")
		}
	}
}
