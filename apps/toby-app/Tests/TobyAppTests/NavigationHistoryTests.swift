import Testing
@testable import TobyApp

@Suite("NavigationHistory")
struct NavigationHistoryTests {
	@Test("initial state starts at chat route")
	func initialStateStartsAtChat() {
		let history = NavigationHistory()
		#expect(history.current == .chat)
		#expect(!history.canGoBack)
		#expect(!history.canGoForward)
	}

	@Test("navigate pushes new route onto stack")
	func navigatePushesNewRoute() {
		let history = NavigationHistory()
		history.navigate(to: .integrations)
		#expect(history.current == .integrations)
		#expect(history.canGoBack)
		#expect(!history.canGoForward)
	}

	@Test("navigate to same route is a no-op")
	func navigateToSameRouteIsNoOp() {
		let history = NavigationHistory()
		history.navigate(to: .integrations)
		history.navigate(to: .integrations)
		#expect(history.current == .integrations)
		#expect(history.stack.count == 2)
		#expect(history.currentIndex == 1)
	}

	@Test("goBack returns previous route")
	func goBackReturnsPreviousRoute() {
		let history = NavigationHistory()
		history.navigate(to: .integrations)
		history.navigate(to: .schedules)
		let route = history.goBack()
		#expect(route == .integrations)
		#expect(history.current == .integrations)
		#expect(history.canGoBack)
		#expect(history.canGoForward)
	}

	@Test("goForward returns next route after going back")
	func goForwardReturnsNextRoute() {
		let history = NavigationHistory()
		history.navigate(to: .integrations)
		history.navigate(to: .schedules)
		_ = history.goBack()
		let route = history.goForward()
		#expect(route == .schedules)
		#expect(history.current == .schedules)
	}

	@Test("goBack at stack bottom returns nil")
	func goBackAtBottomReturnsNil() {
		let history = NavigationHistory()
		#expect(history.goBack() == nil)
	}

	@Test("goForward at stack top returns nil")
	func goForwardAtTopReturnsNil() {
		let history = NavigationHistory()
		history.navigate(to: .integrations)
		#expect(history.goForward() == nil)
	}

	@Test("navigate truncates forward history")
	func navigateTruncatesForwardHistory() {
		let history = NavigationHistory()
		history.navigate(to: .integrations)
		history.navigate(to: .schedules)
		history.navigate(to: .recordings)
		// Go back twice to .integrations
		_ = history.goBack()
		_ = history.goBack()
		#expect(history.current == .integrations)
		#expect(history.canGoForward)
		// Navigate to a new route - should truncate forward history
		history.navigate(to: .skills)
		#expect(history.current == .skills)
		#expect(!history.canGoForward)
		#expect(history.canGoBack)
		// Stack should be [chat, integrations, skills]
		#expect(history.stack.count == 3)
		#expect(history.currentIndex == 2)
	}

	@Test("full navigation cycle preserves stack integrity")
	func fullNavigationCyclePreservesIntegrity() {
		let history = NavigationHistory()
		// chat -> integrations -> schedules -> recordings
		history.navigate(to: .integrations)
		history.navigate(to: .schedules)
		history.navigate(to: .recordings)
		#expect(history.stack.count == 4)
		#expect(history.currentIndex == 3)
		// Back to schedules
		_ = history.goBack()
		#expect(history.current == .schedules)
		// Back to integrations
		_ = history.goBack()
		#expect(history.current == .integrations)
		// Forward to schedules
		_ = history.goForward()
		#expect(history.current == .schedules)
		// Forward to recordings
		_ = history.goForward()
		#expect(history.current == .recordings)
		#expect(!history.canGoForward)
	}
}
