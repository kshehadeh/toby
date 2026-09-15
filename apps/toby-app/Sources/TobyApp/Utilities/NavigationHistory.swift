import SwiftUI

enum DetailRoute: String, CaseIterable, Identifiable {
	case dashboard
	case chat
	case projects
	case schedules
	case flows
	case recordings
	case skills

	var id: String { rawValue }

	/// Display title for menu items (matches sidebar labels).
	var menuTitle: String {
		switch self {
		case .dashboard: return "Home"
		case .chat: return "Chats"
		case .projects: return "Projects"
		case .skills: return "Skills"
		case .schedules: return "Schedules"
		case .flows: return "Flows"
		case .recordings: return "Recordings"
		}
	}

	/// SF Symbol name matching the sidebar icon for this route.
	var systemImage: String {
		switch self {
		case .dashboard: return "house"
		case .chat: return "message"
		case .projects: return "folder"
		case .skills: return "graduationcap"
		case .schedules: return "calendar"
		case .flows: return "arrow.triangle.branch"
		case .recordings: return "waveform"
		}
	}

	/// Primary destinations, in sidebar order.
	static let sidebarPrimary: [DetailRoute] = [.dashboard, .chat, .projects, .recordings]
	/// Automation section, in sidebar order.
	static let sidebarAutomation: [DetailRoute] = [.schedules, .flows]
	/// Tools section, in sidebar order.
	static let sidebarTools: [DetailRoute] = [.skills]

	/// Spoken hint for the destination row.
	var sidebarHint: String {
		switch self {
		case .dashboard:
			return "See what needs your attention: unread mail, open tasks, and setup steps at a glance."
		case .chat:
			return "Open your chat workspace, continue existing conversations, or start a new session with Toby."
		case .projects:
			return "Work inside project folders with scoped chats, local guidance, skills, and generated outputs."
		case .skills:
			return "Browse installed skills, inspect their instructions, edit them, or add new reusable workflows."
		case .schedules:
			return "Create and monitor recurring prompts that run on a schedule through Toby's background daemon."
		case .flows:
			return "Browse named flow pipelines, inspect their nodes, and review recent execution history."
		case .recordings:
			return "Review audio recordings, transcripts, and chats created from recorded context."
		}
	}
}

@Observable
final class NavigationHistory {
	private(set) var stack: [DetailRoute] = [.dashboard]
	private(set) var currentIndex: Int = 0

	var current: DetailRoute { stack[currentIndex] }
	var canGoBack: Bool { currentIndex > 0 }
	var canGoForward: Bool { currentIndex < stack.count - 1 }

	func navigate(to route: DetailRoute) {
		guard route != current else { return }
		stack = Array(stack[0...currentIndex])
		stack.append(route)
		currentIndex += 1
	}

	@discardableResult
	func goBack() -> DetailRoute? {
		guard canGoBack else { return nil }
		currentIndex -= 1
		return stack[currentIndex]
	}

	@discardableResult
	func goForward() -> DetailRoute? {
		guard canGoForward else { return nil }
		currentIndex += 1
		return stack[currentIndex]
	}

	/// Reset to dashboard (used after a Toby home directory switch).
	func resetToDashboard() {
		stack = [.dashboard]
		currentIndex = 0
	}
}

struct SearchToolbarButton: View {
	let onSearch: () -> Void

	var body: some View {
		Button(action: onSearch) {
			Label("Search", systemImage: "magnifyingglass")
				.labelStyle(.titleAndIcon)
		}
		.help("Search")
		.accessibilityLabel("Search")
		.accessibilityIdentifier("toolbar-search-button")
	}
}

struct SettingsToolbarButton: View {
	let onOpenSettings: () -> Void

	var body: some View {
		Button(action: onOpenSettings) {
			Image(systemName: "gearshape")
		}
		.help("Settings")
		.accessibilityLabel("Settings")
		.accessibilityIdentifier("toolbar-settings-button")
	}
}

struct RecordingToolbarButton: View {
	let isRecordingActive: Bool
	var isRecordingProcessing: Bool = false
	let isRecordButtonDisabled: Bool
	let onToggleRecording: () -> Void

	private var label: String {
		if isRecordingProcessing { return "Processing recording" }
		if isRecordingActive { return "Stop Recording" }
		return "Record Audio"
	}

	var body: some View {
		Button(action: onToggleRecording) {
			Image(systemName: iconName)
				.foregroundStyle(iconColor)
		}
		.help(label)
		.accessibilityLabel(label)
		.accessibilityIdentifier("toolbar-record-button")
		.disabled(isRecordButtonDisabled || isRecordingProcessing)
	}

	private var iconName: String {
		if isRecordingProcessing { return "hourglass" }
		if isRecordingActive { return "stop.circle" }
		return "record.circle"
	}

	private var iconColor: Color {
		if isRecordingProcessing { return .orange }
		if isRecordingActive { return .red }
		return .primary
	}
}
