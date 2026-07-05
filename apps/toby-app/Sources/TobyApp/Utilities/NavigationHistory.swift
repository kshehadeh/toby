import SwiftUI

enum DetailRoute: String, CaseIterable, Identifiable {
	case dashboard
	case chat
	case projects
	case integrations
	case schedules
	case recordings
	case skills
	case memories
	case settings

	var id: String { rawValue }

	/// Display title for menu items (matches sidebar labels).
	var menuTitle: String {
		switch self {
		case .dashboard: return "Dashboard"
		case .chat: return "Chats"
		case .integrations: return "Integrations"
		case .projects: return "Projects"
		case .skills: return "Skills"
		case .memories: return "Memories"
		case .schedules: return "Schedules"
		case .recordings: return "Recordings"
		case .settings: return "Settings…"
		}
	}

	/// SF Symbol name matching the sidebar icon for this route.
	var systemImage: String {
		switch self {
		case .dashboard: return "rectangle.3.group"
		case .chat: return "message"
		case .integrations: return "square.grid.2x2"
		case .projects: return "folder"
		case .skills: return "wand.and.stars"
		case .memories: return "brain.head.profile"
		case .schedules: return "clock"
		case .recordings: return "waveform"
		case .settings: return "gearshape"
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

struct RecordingToolbarButton: View {
	let isRecordingActive: Bool
	let isRecordButtonDisabled: Bool
	let onToggleRecording: () -> Void

	var body: some View {
		Button(action: onToggleRecording) {
			Image(systemName: isRecordingActive ? "stop.circle" : "record.circle")
				.foregroundStyle(isRecordingActive ? .red : .primary)
		}
		.help(isRecordingActive ? "Stop Recording" : "Record Audio")
		.accessibilityLabel(isRecordingActive ? "Stop Recording" : "Record Audio")
		.accessibilityIdentifier("toolbar-record-button")
		.disabled(isRecordButtonDisabled)
	}
}
