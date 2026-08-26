import SwiftUI

enum DetailRoute: String, CaseIterable, Identifiable {
	case dashboard
	case chat
	case projects
	case integrations
	case schedules
	case flows
	case recordings
	case skills
	case memories

	var id: String { rawValue }

	/// Display title for menu items (matches sidebar labels).
	var menuTitle: String {
		switch self {
		case .dashboard: return "Home"
		case .chat: return "Chats"
		case .integrations: return "Integrations"
		case .projects: return "Projects"
		case .skills: return "Skills"
		case .memories: return "Memories"
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
		case .integrations: return "square.grid.2x2"
		case .projects: return "folder"
		case .skills: return "wand.and.stars"
		case .memories: return "brain.head.profile"
		case .schedules: return "clock"
		case .flows: return "arrow.triangle.branch"
		case .recordings: return "waveform"
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
			Image(systemName: "magnifyingglass")
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
