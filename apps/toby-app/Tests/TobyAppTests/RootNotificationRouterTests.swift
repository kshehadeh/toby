import Testing
@testable import TobyApp

@MainActor
@Suite("RootNotificationRouter")
struct RootNotificationRouterTests {
	@Test("shouldRefreshRecordings covers transcription lifecycle stages")
	func shouldRefreshRecordingsStages() {
		#expect(RootNotificationRouter.shouldRefreshRecordings(for: .preparingTranscription))
		#expect(RootNotificationRouter.shouldRefreshRecordings(for: .transcribing))
		#expect(RootNotificationRouter.shouldRefreshRecordings(for: .complete))
		#expect(RootNotificationRouter.shouldRefreshRecordings(for: .failed))
		#expect(!RootNotificationRouter.shouldRefreshRecordings(for: .generatingAudio))
		#expect(!RootNotificationRouter.shouldRefreshRecordings(for: .finalizing))
	}
}
