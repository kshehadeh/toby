import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("ToastView")
struct ToastViewTests {
	@Test("renders action button when action is present")
	func rendersActionButton() throws {
		let toast = AppToastState(
			style: .success,
			title: "Recording transcribed",
			message: "Your recording is ready.",
			action: .openRecording(id: "rec-123")
		)
		let view = ToastView(
			toast: toast,
			onDismiss: {},
			onAction: { _ in }
		)
		_ = try view.inspect().find(ViewType.Button.self) { button in
			let text = try? button.labelView().find(ViewType.Text.self).string()
			return text == "Open recording"
		}
	}

	@Test("action button is hidden when action is nil")
	func hidesActionButtonWhenAbsent() throws {
		let toast = AppToastState(
			style: .success,
			title: "Recording transcribed",
			message: "Your recording is ready."
		)
		let view = ToastView(
			toast: toast,
			onDismiss: {},
			onAction: { _ in }
		)
		#expect(throws: Error.self) {
			try view.inspect().find(ViewType.Button.self) { button in
				let text = try? button.labelView().find(ViewType.Text.self).string()
				return text == "Open recording"
			}
		}
	}

	@Test("tapping action button invokes onAction and dismisses")
	func actionButtonTaps() throws {
		var capturedAction: AppToastAction?
		var dismissed = false
		let toast = AppToastState(
			style: .success,
			title: "Recording transcribed",
			message: "Your recording is ready.",
			action: .openRecording(id: "rec-456")
		)
		let view = ToastView(
			toast: toast,
			onDismiss: { dismissed = true },
			onAction: { capturedAction = $0 }
		)
		let button = try view.inspect().find(ViewType.Button.self) { button in
			let text = try? button.labelView().find(ViewType.Text.self).string()
			return text == "Open recording"
		}
		try button.tap()
		#expect(capturedAction == .openRecording(id: "rec-456"))
		#expect(dismissed == true)
	}

	@Test("progress toast renders progress view instead of icon")
	func progressToastShowsSpinner() throws {
		let toast = AppToastState(
			style: .progress,
			title: "Processing recording",
			message: "Transcribing…"
		)
		let view = ToastView(
			toast: toast,
			onDismiss: {},
			onAction: { _ in }
		)
		#expect(throws: Never.self) {
			try view.inspect().find(ViewType.ProgressView.self)
		}
	}

	@Test("progress toast does not render dismiss button")
	func progressToastHidesDismissButton() throws {
		let toast = AppToastState(
			style: .progress,
			title: "Processing recording",
			message: "Generating final audio…"
		)
		let view = ToastView(
			toast: toast,
			onDismiss: {},
			onAction: { _ in }
		)
		// The only button that could exist is the action button (none here),
		// so finding any button should fail.
		#expect(throws: Error.self) {
			try view.inspect().find(ViewType.Button.self)
		}
	}

	@Test("progress toast with completion action renders open recording button")
	func progressToastWithActionRendersButton() throws {
		let state = RecordingProcessingState(
			recordingId: "rec-789",
			stage: .complete,
			message: "Your recording is ready."
		)
		let view = ToastView(
			toast: state.toastState(),
			onDismiss: {},
			onAction: { _ in }
		)
		#expect(throws: Never.self) {
			try view.inspect().find(ViewType.Button.self) { button in
				let text = try? button.labelView().find(ViewType.Text.self).string()
				return text == "Open recording"
			}
		}
	}
}
