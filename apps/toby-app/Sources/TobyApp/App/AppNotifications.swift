import Foundation

// MARK: - App-wide notification names

/// Cross-window / menu-bar / AppKit bridge events handled by the main shell.
/// Keep string raw values stable — external posters (menu bar, native handlers)
/// and tests depend on them.
extension Notification.Name {
	static let openCommandPalette = Notification.Name("openCommandPalette")
	static let openIssueReport = Notification.Name("openIssueReport")
	static let openChangelog = Notification.Name("openChangelog")
	static let openRecordingFromToast = Notification.Name("openRecordingFromToast")
	static let startNewChat = Notification.Name("startNewChat")
	static let startNewSchedule = Notification.Name("startNewSchedule")
	static let startNewSkill = Notification.Name("startNewSkill")
	static let startNewProject = Notification.Name("startNewProject")
	static let startNewMemory = Notification.Name("startNewMemory")
	static let startChatAboutRecording = Notification.Name("startChatAboutRecording")
	static let showChatSession = Notification.Name("showChatSession")
	static let secondaryWindowClosed = Notification.Name("secondaryWindowClosed")
	static let menuBarToggleRecording = Notification.Name("menuBarToggleRecording")
	static let navigateToRoute = Notification.Name("navigateToRoute")
	static let openSettingsWindow = Notification.Name("openSettingsWindow")
	static let openMemoriesWindow = Notification.Name("openMemoriesWindow")
	static let openConnectionStatus = Notification.Name("openConnectionStatus")
	static let openScheduleFromNotification = Notification.Name("openScheduleFromNotification")
	static let backupConfig = Notification.Name("backupConfig")
	static let restoreConfig = Notification.Name("restoreConfig")
	/// Posted when chat (or another writer) mutates durable memory so the memories UI can refresh.
	static let memoriesDidChange = Notification.Name("toby.memoriesDidChange")
	/// Posted when chat (or another writer) mutates the file library so the Library UI can refresh.
	static let libraryDidChange = Notification.Name("toby.libraryDidChange")
	static let personasDidChange = Notification.Name("toby.personasDidChange")
	/// Posted when chat (or another writer) creates/updates a local skill so the skills UI can refresh.
	static let skillsDidChange = Notification.Name("toby.skillsDidChange")
	/// Posted after guided setup connects an integration so Home can refresh that card.
	/// `object` is the dashboard block id (`"news"`, …).
	static let dashboardBlockShouldRefresh = Notification.Name("toby.dashboardBlockShouldRefresh")
	/// Posted after a successful in-process Toby home directory switch.
	/// Shell should clear feature stores and reload from the new data root.
	static let tobyHomeDidChange = Notification.Name("toby.homeDidChange")
}

// MARK: - Notification payloads / sheet models

struct RestoreBackupSelection: Identifiable {
	let id = UUID()
	let url: URL
}

struct StartChatAboutRecordingRequest {
	let recordingId: String
	let name: String
	let dateText: String
	let hourText: String
}

struct OpenScheduleFromNotificationRequest {
	let scheduleId: String
}
