import SwiftUI

/// Routes app-wide `NotificationCenter` events (menus, menu bar, secondary
/// windows, recording lifecycle side effects) into shell callbacks.
///
/// Keeps the large `.onReceive` chains off `RootView` without introducing a
/// second global event bus. Split into private helpers so the Swift type
/// checker can finish in reasonable time.
struct RootNotificationRouter: ViewModifier {
	var onStartNewSchedule: () -> Void
	var onStartNewProject: () -> Void
	var onStartNewMemory: () -> Void
	var onMemoriesDidChange: () -> Void
	var onPersonasDidChange: () -> Void
	var onSkillsDidChange: () -> Void
	var onTobyHomeDidChange: () -> Void
	var onBackupConfig: () -> Void
	var onRestoreConfig: () -> Void
	var onOpenCommandPalette: () -> Void
	var onOpenIssueReport: () -> Void
	var onOpenChangelog: () -> Void
	var onOpenRecording: (String) -> Void
	var onOpenScheduleFromNotification: (String) -> Void
	var onStartNewChat: () -> Void
	var onToggleRecording: () -> Void
	var onSecondaryWindowClosed: () -> Void
	var onStartChatAboutRecording: (StartChatAboutRecordingRequest) -> Void
	var onShowChatSession: (String) -> Void
	var onNavigateToRoute: (DetailRoute) -> Void
	var onOpenSettings: (String?) -> Void
	/// Mirrors recording capture state to the menu bar / dock indicator.
	var isRecordingActive: Bool
	var recordingProcessingStage: RecordingProcessingStage?
	var recordingProcessingRecordingId: String?
	var onRefreshRecordingsAfterProcessing: (String?) -> Void

	func body(content: Content) -> some View {
		withRecordingObservers(
			withSessionReceivers(
				withShellReceivers(
					withBackupReceivers(
						withCreateReceivers(content)
					)
				)
			)
		)
	}

	// MARK: - Chunked receivers (type-checker budget)

	private func withCreateReceivers(_ content: Content) -> some View {
		content
			.onReceive(NotificationCenter.default.publisher(for: .startNewSchedule)) { _ in
				onStartNewSchedule()
			}
			.onReceive(NotificationCenter.default.publisher(for: .startNewProject)) { _ in
				onStartNewProject()
			}
			.onReceive(NotificationCenter.default.publisher(for: .startNewMemory)) { _ in
				onStartNewMemory()
			}
			.onReceive(NotificationCenter.default.publisher(for: .memoriesDidChange)) { _ in
				onMemoriesDidChange()
			}
			.onReceive(NotificationCenter.default.publisher(for: .personasDidChange)) { _ in
				onPersonasDidChange()
			}
			.onReceive(NotificationCenter.default.publisher(for: .skillsDidChange)) { _ in
				onSkillsDidChange()
			}
			.onReceive(NotificationCenter.default.publisher(for: .tobyHomeDidChange)) { _ in
				onTobyHomeDidChange()
			}
	}

	private func withBackupReceivers<V: View>(_ content: V) -> some View {
		content
			.onReceive(NotificationCenter.default.publisher(for: .backupConfig)) { _ in
				onBackupConfig()
			}
			.onReceive(NotificationCenter.default.publisher(for: .restoreConfig)) { _ in
				onRestoreConfig()
			}
	}

	private func withShellReceivers<V: View>(_ content: V) -> some View {
		content
			.onReceive(NotificationCenter.default.publisher(for: .openCommandPalette)) { _ in
				onOpenCommandPalette()
			}
			.onReceive(NotificationCenter.default.publisher(for: .openIssueReport)) { _ in
				onOpenIssueReport()
			}
			.onReceive(NotificationCenter.default.publisher(for: .openChangelog)) { _ in
				onOpenChangelog()
			}
			.onReceive(NotificationCenter.default.publisher(for: .openRecordingFromToast)) { notification in
				if let id = notification.object as? String {
					onOpenRecording(id)
				}
			}
			.onReceive(NotificationCenter.default.publisher(for: .openScheduleFromNotification)) { notification in
				guard let request = notification.object as? OpenScheduleFromNotificationRequest else { return }
				onOpenScheduleFromNotification(request.scheduleId)
			}
			.onReceive(NotificationCenter.default.publisher(for: .startNewChat)) { _ in
				onStartNewChat()
			}
			.onReceive(NotificationCenter.default.publisher(for: .menuBarToggleRecording)) { _ in
				onToggleRecording()
			}
			.onReceive(NotificationCenter.default.publisher(for: .secondaryWindowClosed)) { _ in
				onSecondaryWindowClosed()
			}
	}

	private func withSessionReceivers<V: View>(_ content: V) -> some View {
		content
			.onReceive(NotificationCenter.default.publisher(for: .startChatAboutRecording)) { notification in
				guard let request = notification.object as? StartChatAboutRecordingRequest else { return }
				onStartChatAboutRecording(request)
			}
			.onReceive(NotificationCenter.default.publisher(for: .showChatSession)) { notification in
				guard let sessionId = notification.object as? String else { return }
				onShowChatSession(sessionId)
			}
			.onReceive(NotificationCenter.default.publisher(for: .navigateToRoute)) { notification in
				if let raw = notification.object as? String,
					let route = DetailRoute(rawValue: raw)
				{
					onNavigateToRoute(route)
				}
			}
			.onReceive(NotificationCenter.default.publisher(for: .openSettingsWindow)) { notification in
				// Prefer `object` (primary); accept userInfo["navKey"] as a fallback.
				let navKey =
					(notification.object as? String)
					?? (notification.userInfo?["navKey"] as? String)
				onOpenSettings(navKey)
			}
	}

	private func withRecordingObservers<V: View>(_ content: V) -> some View {
		content
			.onChange(of: isRecordingActive) { _, active in
				NotificationCenter.default.post(name: MenuBarController.recordingStateChanged, object: active)
			}
			.onChange(of: recordingProcessingStage) { _, stage in
				handleRecordingProcessingStageChange(stage)
			}
	}

	private func handleRecordingProcessingStageChange(_ stage: RecordingProcessingStage?) {
		// Fallback: ensure the dock/menu bar overlay is cleared when
		// recording processing finishes, even if isRecordingActive
		// already transitioned without the capture onChange firing.
		if (stage == .complete || stage == .failed), !isRecordingActive {
			NotificationCenter.default.post(name: MenuBarController.recordingStateChanged, object: false)
		}
		// Refresh Recordings globally — RecordingsView is not mounted on
		// other routes, so its local onChange would never run.
		if let stage, Self.shouldRefreshRecordings(for: stage) {
			onRefreshRecordingsAfterProcessing(recordingProcessingRecordingId)
		}
	}

	/// Stages that imply the recordings list or detail may have changed.
	nonisolated static func shouldRefreshRecordings(for stage: RecordingProcessingStage) -> Bool {
		switch stage {
		case .preparingTranscription, .transcribing, .complete, .failed:
			true
		case .generatingAudio, .finalizing:
			false
		}
	}
}
