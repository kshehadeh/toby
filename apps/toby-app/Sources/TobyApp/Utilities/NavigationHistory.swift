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

struct NavigationHistoryToolbar: ViewModifier {
	let history: NavigationHistory

	func body(content: Content) -> some View {
		content.toolbar {
			ToolbarItem(placement: .navigation) {
				Button(action: { _ = history.goBack() }) {
					Image(systemName: "chevron.backward")
				}
				.disabled(!history.canGoBack)
				.help("Back")
				.accessibilityIdentifier("nav-back-button")
			}
			ToolbarItem(placement: .navigation) {
				Button(action: { _ = history.goForward() }) {
					Image(systemName: "chevron.forward")
				}
				.disabled(!history.canGoForward)
				.help("Forward")
				.accessibilityIdentifier("nav-forward-button")
			}
		}
	}
}
