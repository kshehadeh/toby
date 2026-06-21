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
}
