import Foundation
import Observation
import SwiftUI

struct LongRecordingPrompt: Identifiable, Equatable {
	let id = UUID()
	let recordingId: String
	let startedAt: Date
	let promptStartedAt: Date
	var remainingSeconds: Int
}

enum LongRecordingPromptAction: Equatable {
	case present
	case stop
}

@Observable
@MainActor
final class LongRecordingPromptCoordinator {
	static let firstPromptDelay: TimeInterval = 60 * 60
	static let repeatedPromptDelay: TimeInterval = 30 * 60
	static let countdownDuration = 60

	var presentedPrompt: LongRecordingPrompt?

	private var activeRecordingId: String?
	private var activeRecordingStartedAt: Date?
	private var nextPromptAt: Date?

	var nextPromptDateForTesting: Date? { nextPromptAt }

	func updateRecordingStatus(
		isActive: Bool,
		sessionId: String?,
		startedAt rawStartedAt: String?,
	) {
		guard isActive, let sessionId, let rawStartedAt else {
			reset()
			return
		}
		guard let startedAt = parseRecordingDate(rawStartedAt) else {
			reset()
			return
		}

		if activeRecordingId != sessionId || activeRecordingStartedAt != startedAt {
			activeRecordingId = sessionId
			activeRecordingStartedAt = startedAt
			nextPromptAt = startedAt.addingTimeInterval(Self.firstPromptDelay)
			presentedPrompt = nil
		}
	}

	func advance(now: Date) -> LongRecordingPromptAction? {
		guard activeRecordingId != nil else {
			reset()
			return nil
		}

		if let prompt = presentedPrompt {
			let elapsed = max(0, Int(now.timeIntervalSince(prompt.promptStartedAt)))
			let remaining = max(0, Self.countdownDuration - elapsed)
			if remaining != prompt.remainingSeconds {
				presentedPrompt?.remainingSeconds = remaining
			}
			if remaining <= 0 {
				reset()
				return .stop
			}
			return nil
		}

		if let nextPromptAt, nextPromptAt <= now {
			presentPrompt(now: now)
			return .present
		}

		return nil
	}

	func continueRecording(now: Date) {
		presentedPrompt = nil
		nextPromptAt = now.addingTimeInterval(Self.repeatedPromptDelay)
	}

	func stopRecording() -> LongRecordingPromptAction {
		reset()
		return .stop
	}

	private func presentPrompt(now: Date) {
		guard let activeRecordingId, let activeRecordingStartedAt else { return }
		presentedPrompt = LongRecordingPrompt(
			recordingId: activeRecordingId,
			startedAt: activeRecordingStartedAt,
			promptStartedAt: now,
			remainingSeconds: Self.countdownDuration,
		)
	}

	private func reset() {
		activeRecordingId = nil
		activeRecordingStartedAt = nil
		nextPromptAt = nil
		presentedPrompt = nil
	}
}

private func parseRecordingDate(_ value: String) -> Date? {
	let fractional = ISO8601DateFormatter()
	fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
	if let date = fractional.date(from: value) {
		return date
	}
	let standard = ISO8601DateFormatter()
	standard.formatOptions = [.withInternetDateTime]
	return standard.date(from: value)
}

struct LongRecordingConfirmationView: View {
	let prompt: LongRecordingPrompt
	let onContinue: () -> Void
	let onStop: () -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 18) {
			HStack(alignment: .top, spacing: 12) {
				Image(systemName: "waveform.circle.fill")
					.font(.system(size: 30, weight: .semibold))
					.foregroundStyle(.red)
					.accessibilityHidden(true)

				VStack(alignment: .leading, spacing: 6) {
					Text("Continue recording?")
						.font(.title3.weight(.semibold))
						.foregroundStyle(AppTheme.primaryText)
					Text("This recording has been running for more than an hour.")
						.font(.body)
						.foregroundStyle(AppTheme.secondaryText)
				}
			}

			Text("Toby will stop and save it in \(countdownText) unless you continue.")
				.font(.callout)
				.foregroundStyle(AppTheme.secondaryText)
				.fixedSize(horizontal: false, vertical: true)

			Text("Stops in \(countdownText)")
				.font(.system(.title2, design: .monospaced).weight(.semibold))
				.foregroundStyle(.red)
				.accessibilityIdentifier("long-recording-countdown")
				.accessibilityLabel("Recording stops in \(countdownText)")

			HStack(spacing: 10) {
				Button("Stop and Save", role: .destructive) {
					onStop()
				}
				.keyboardShortcut(.cancelAction)
				.accessibilityIdentifier("long-recording-stop-button")

				Spacer()

				Button("Continue Recording") {
					onContinue()
				}
				.keyboardShortcut(.defaultAction)
				.buttonStyle(.borderedProminent)
				.accessibilityIdentifier("long-recording-continue-button")
			}
		}
		.padding(24)
		.frame(width: 420)
		.background(SettingsDesign.cardBackground)
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier("long-recording-confirmation")
	}

	private var countdownText: String {
		let seconds = max(0, prompt.remainingSeconds)
		return String(format: "%d:%02d", seconds / 60, seconds % 60)
	}
}
