import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("AssistantMessageRow")
struct AssistantMessageRowTests {
	@Test("renders the answer without a persona rail or assistant header")
	func rendersDocumentAnswer() throws {
		let view = AssistantMessageRow(
			messageBody: "You have 5 unread emails.",
			isStreaming: false,
			createdAt: "2026-09-16T12:00:00Z"
		)

		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "assistant-message-row")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(text: "You have 5 unread emails.")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(text: "Assistant")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(ViewType.ProgressView.self)
		}
	}

	@Test("shows copy actions after the answer completes")
	func showsCopyActionsWhenComplete() throws {
		let view = AssistantMessageRow(
			messageBody: "Done.",
			isStreaming: false,
			createdAt: "2026-09-16T12:00:00Z"
		)

		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "transcript-message-actions")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(CopyButton.self)
		}
	}

	@Test("hides copy and time while the answer is streaming")
	func hidesActionsWhileStreaming() throws {
		let view = AssistantMessageRow(
			messageBody: "Partial",
			isStreaming: true,
			createdAt: "2026-09-16T12:00:00Z"
		)

		#expect(throws: (any Error).self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "transcript-message-actions")
		}
		#expect(throws: (any Error).self) {
			try view.inspect().find(ViewType.ProgressView.self)
		}
	}
}
