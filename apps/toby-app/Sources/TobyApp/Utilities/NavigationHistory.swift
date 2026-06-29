import SwiftUI

enum DetailRoute: String, CaseIterable {
	case chat
	case integrations
	case schedules
	case recordings
	case skills
	case settings
}

@Observable
final class NavigationHistory {
	private(set) var stack: [DetailRoute] = [.chat]
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
