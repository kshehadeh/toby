import Testing
import TobyAI
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("Gateway funds banner")
struct GatewayFundsBannerTests {
	private func notice() -> GatewayFundsNotice {
		GatewayFundsNotice(activity: "send your message")
	}

	@Test("names the gateway and the attempt")
	func rendersCopy() throws {
		let view = GatewayFundsBanner(
			notice: notice(),
			onOpenSettings: { _ in },
			onClose: {}
		)
		let text = try view.inspect().findAll(ViewType.Text.self).map { try $0.string() }
		#expect(text.contains("OpenRouter is out of credits"))
		#expect(text.contains("Toby couldn't send your message."))
	}

	@Test("Open Settings opens Account and leaves the banner up")
	func openSettingsDoesNotClose() throws {
		var navKey: String?
		var closed = false
		let view = GatewayFundsBanner(
			notice: notice(),
			onOpenSettings: { navKey = $0 },
			onClose: { closed = true }
		)
		try view.inspect().find(button: "Open Settings").tap()
		#expect(navKey == "account")
		#expect(closed == false)
	}

	@Test("Close is the only dismiss control")
	func closeDismisses() throws {
		var closed = false
		let view = GatewayFundsBanner(
			notice: notice(),
			onOpenSettings: { _ in },
			onClose: { closed = true }
		)
		let close = try view.inspect().find(ViewType.Button.self) { button in
			(try? button.accessibilityLabel().string()) == "Close"
		}
		try close.tap()
		#expect(closed == true)
	}
}

@MainActor
@Suite("Gateway funds presentation")
struct GatewayFundsPresentationTests {
	@Test("a funds failure does not also set an error toast")
	func skipsToast() {
		let store = ChatStore()
		store.presentFailure(
			TobyClientError.gatewayFunds("Your OpenRouter account is out of credits.")
		)
		#expect(store.toast == nil)

		store.presentFailure(TobyClientError.serverError("Daemon unavailable"))
		#expect(store.toast?.style == .error)
		#expect(store.toast?.message == "Daemon unavailable")
	}

	@Test("a later funds failure replaces the notice in place")
	func replacesNotice() {
		let store = ChatStore()
		store.gatewayFundsNotice = GatewayFundsNotice(activity: "send your message")
		store.gatewayFundsNotice = GatewayFundsNotice(activity: "update the dashboard")
		#expect(store.gatewayFundsNotice?.message == "Toby couldn't update the dashboard.")
		#expect(store.gatewayFundsNotice?.settingsNavKey == "account")
	}

	@Test("native out-of-credits errors and codes map to the notice")
	func mapsNativeSignals() {
		#expect(GatewayFundsNotice(error: AIError.insufficientCredits(message: ""), activity: "x") != nil)
		#expect(GatewayFundsNotice(error: AIError.cancelled, activity: "x") == nil)
		#expect(GatewayFundsNotice(json: ["code": "insufficient_credits", "activity": "run a flow"])?.message == "Toby couldn't run a flow.")
		#expect(GatewayFundsNotice(libraryError: "Your OpenRouter account is out of credits.") != nil)
		#expect(GatewayFundsNotice(libraryError: "Some other failure") == nil)
	}

	@Test("transcription funds failure keeps the local status and skips the toast")
	func transcriptionSkipsToast() {
		var state = ChatRecordingUIState(
			listenStatus: nil,
			recordingProcessing: nil,
			toast: nil,
			activityLine: "Ready"
		)
		ChatRecordingController.applyTranscriptionFailed(
			recordingId: "rec-1",
			errorDescription: "Your OpenRouter account is out of credits.",
			suppressToast: true,
			into: &state
		)
		#expect(state.toast == nil)
		#expect(state.recordingProcessing?.stage == .failed)
		#expect(state.recordingProcessing?.message?.contains("out of credits") == true)
	}
}
