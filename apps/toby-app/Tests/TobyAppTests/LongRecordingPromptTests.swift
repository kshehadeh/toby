import Foundation
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("LongRecordingPrompt")
struct LongRecordingPromptTests {
	private let startedAt = Date(timeIntervalSinceReferenceDate: 1_000)
	private var startedAtString: String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return formatter.string(from: startedAt)
	}

	@Test("first prompt is scheduled at one hour from recording start")
	func firstPromptScheduledAtOneHour() {
		let coordinator = LongRecordingPromptCoordinator()

		coordinator.updateRecordingStatus(
			isActive: true,
			sessionId: "recording-1",
			startedAt: startedAtString
		)

		#expect(coordinator.nextPromptDateForTesting == startedAt.addingTimeInterval(60 * 60))
		#expect(coordinator.presentedPrompt == nil)
	}

	@Test("due prompt presents and continue schedules another prompt in thirty minutes")
	func continueSchedulesNextPrompt() {
		let coordinator = LongRecordingPromptCoordinator()
		let dueAt = startedAt.addingTimeInterval(60 * 60)

		coordinator.updateRecordingStatus(
			isActive: true,
			sessionId: "recording-1",
			startedAt: startedAtString
		)
		let action = coordinator.advance(now: dueAt)
		#expect(action == .present)
		#expect(coordinator.presentedPrompt?.remainingSeconds == 60)

		let continuedAt = dueAt.addingTimeInterval(10)
		coordinator.continueRecording(now: continuedAt)

		#expect(coordinator.presentedPrompt == nil)
		#expect(coordinator.nextPromptDateForTesting == continuedAt.addingTimeInterval(30 * 60))
	}

	@Test("countdown expiration requests stop once")
	func countdownExpirationRequestsStopOnce() {
		let coordinator = LongRecordingPromptCoordinator()
		let dueAt = startedAt.addingTimeInterval(60 * 60)

		coordinator.updateRecordingStatus(
			isActive: true,
			sessionId: "recording-1",
			startedAt: startedAtString
		)
		#expect(coordinator.advance(now: dueAt) == .present)

		let stopAction = coordinator.advance(now: dueAt.addingTimeInterval(60))
		let secondAction = coordinator.advance(now: dueAt.addingTimeInterval(61))

		#expect(stopAction == .stop)
		#expect(secondAction == nil)
		#expect(coordinator.presentedPrompt == nil)
	}

	@Test("inactive recording cancels pending prompt state")
	func inactiveRecordingCancelsPromptState() {
		let coordinator = LongRecordingPromptCoordinator()

		coordinator.updateRecordingStatus(
			isActive: true,
			sessionId: "recording-1",
			startedAt: startedAtString
		)
		coordinator.updateRecordingStatus(
			isActive: false,
			sessionId: nil,
			startedAt: nil
		)

		#expect(coordinator.nextPromptDateForTesting == nil)
		#expect(coordinator.presentedPrompt == nil)
		#expect(coordinator.advance(now: startedAt.addingTimeInterval(60 * 60)) == nil)
	}

	@Test("confirmation view renders countdown")
	func confirmationViewRendersCountdown() throws {
		let view = LongRecordingConfirmationView(
			prompt: LongRecordingPrompt(
				recordingId: "recording-1",
				startedAt: startedAt,
				promptStartedAt: startedAt.addingTimeInterval(60 * 60),
				remainingSeconds: 60,
			),
			onContinue: {},
			onStop: {},
		)

		#expect(throws: Never.self) {
			try view.inspect().find(text: "Stops in 1:00")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "long-recording-countdown")
		}
	}

	@Test("confirmation view continue and stop buttons call handlers")
	func confirmationViewButtonsCallHandlers() throws {
		var didContinue = false
		var didStop = false
		let view = LongRecordingConfirmationView(
			prompt: LongRecordingPrompt(
				recordingId: "recording-1",
				startedAt: startedAt,
				promptStartedAt: startedAt.addingTimeInterval(60 * 60),
				remainingSeconds: 42,
			),
			onContinue: { didContinue = true },
			onStop: { didStop = true },
		)

		let buttons = try view.inspect().findAll(ViewType.Button.self)
		let continueButton = buttons.first { button in
			(try? button.find(text: "Continue Recording")) != nil
		}
		let stopButton = buttons.first { button in
			(try? button.find(text: "Stop and Save")) != nil
		}

		try #require(continueButton != nil, "Continue button not found")
		try #require(stopButton != nil, "Stop button not found")

		try continueButton?.tap()
		try stopButton?.tap()

		#expect(didContinue)
		#expect(didStop)
	}
}
