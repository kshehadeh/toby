import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("InlineStatusMessage")
struct InlineStatusMessageTests {
	@Test("renders message text")
	func rendersMessage() throws {
		let view = InlineStatusMessage(
			message: "Calendar.app reachable; validated 7 tool check(s).",
			tone: .success
		)
		#expect(throws: Never.self) {
			_ = try view.inspect().find(text: "Calendar.app reachable; validated 7 tool check(s).")
		}
	}

	@Test("error tone uses error icon")
	func errorIcon() throws {
		let view = InlineStatusMessage(message: "Permission denied", tone: .error)
		let image = try view.inspect().find(ViewType.Image.self)
		#expect(try image.actualImage().name() == "exclamationmark.triangle.fill")
	}

	@Test("success tone uses success icon")
	func successIcon() throws {
		let view = InlineStatusMessage(message: "Connected", tone: .success)
		let image = try view.inspect().find(ViewType.Image.self)
		#expect(try image.actualImage().name() == "checkmark.circle.fill")
	}

	@Test("custom system image overrides default")
	func customIcon() throws {
		let view = InlineStatusMessage(
			message: "Heads up",
			tone: .error,
			systemImage: "info.circle.fill"
		)
		let image = try view.inspect().find(ViewType.Image.self)
		#expect(try image.actualImage().name() == "info.circle.fill")
	}

	@Test("tone colors match AppTheme tokens")
	func toneColors() {
		#expect(InlineStatusTone.error.background == AppTheme.statusErrorBackground)
		#expect(InlineStatusTone.error.border == AppTheme.statusErrorBorder)
		#expect(InlineStatusTone.error.foreground == AppTheme.statusErrorForeground)
		#expect(InlineStatusTone.success.background == AppTheme.statusSuccessBackground)
		#expect(InlineStatusTone.success.border == AppTheme.statusSuccessBorder)
		#expect(InlineStatusTone.success.foreground == AppTheme.statusSuccessForeground)
	}
}
