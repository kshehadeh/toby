import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("ChatSessionsSidebar")
struct ChatSessionsSidebarTests {
	@Test("empty sessions shows placeholder text")
	func emptySessionsShowsPlaceholder() throws {
		let view = ChatSessionsSidebar(
			sessions: [],
			selectedSessionId: nil,
			isLoading: false,
			isSessionsLoading: false,
			onSelectSession: { _ in },
			onDeleteSession: { _ in }
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "No past sessions") }
	}

	@Test("loading sessions shows loading text")
	func loadingSessionsShowsLoadingText() throws {
		let view = ChatSessionsSidebar(
			sessions: [],
			selectedSessionId: nil,
			isLoading: false,
			isSessionsLoading: true,
			onSelectSession: { _ in },
			onDeleteSession: { _ in }
		)
		#expect(throws: Never.self) { try view.inspect().find(text: "Loading sessions…") }
	}

	@Test("session count matches provided data")
	func sessionCountMatchesData() throws {
		let sessions = [
			SessionSummary(id: "1", name: "First Session", createdAt: nil, updatedAt: nil),
			SessionSummary(id: "2", name: "Second Session", createdAt: nil, updatedAt: nil),
		]
		let view = ChatSessionsSidebar(
			sessions: sessions,
			selectedSessionId: nil,
			isLoading: false,
			isSessionsLoading: false,
			onSelectSession: { _ in },
			onDeleteSession: { _ in }
		)
		let buttons = try view.inspect().findAll(ViewType.Button.self)
		let sessionButtons = buttons.filter { btn in
			guard let label = try? btn.labelView().find(ViewType.Text.self),
			      let text = try? label.string() else { return false }
			return sessions.map(\.name).contains(text)
		}
		#expect(sessionButtons.count == 2)
	}

	@Test("empty-area tap calls onClearSelection")
	func emptyAreaTapClearsSelection() throws {
		var cleared = false
		let session = SessionSummary(id: "abc", name: "My Session", createdAt: nil, updatedAt: nil)
		let view = ChatSessionsSidebar(
			sessions: [session],
			selectedSessionId: "abc",
			isLoading: false,
			isSessionsLoading: false,
			onSelectSession: { _ in },
			onDeleteSession: { _ in },
			onClearSelection: { cleared = true }
		)
		let target = try view.inspect().find(
			viewWithAccessibilityIdentifier: "feature-browser-list-deselect"
		)
		try target.button().tap()
		#expect(cleared)
	}

	@Test("tapping session button calls onSelectSession")
	func selectSessionCallback() throws {
		var selectedId: String?
		let session = SessionSummary(id: "abc", name: "My Session", createdAt: nil, updatedAt: nil)
		let view = ChatSessionsSidebar(
			sessions: [session],
			selectedSessionId: nil,
			isLoading: false,
			isSessionsLoading: false,
			onSelectSession: { selectedId = $0 },
			onDeleteSession: { _ in }
		)
		let buttons = try view.inspect().findAll(ViewType.Button.self)
		let sessionButton = buttons.first { btn in
			(try? btn.find(text: "My Session")) != nil
		}
		try #require(sessionButton != nil, "Session button not found")
		try sessionButton!.tap()
		#expect(selectedId == "abc")
	}

	@Test("session with createdAt shows formatted date subtitle")
	func sessionShowsDateSubtitle() throws {
		let sessions = [
			SessionSummary(id: "1", name: "Dated Session", createdAt: "2026-06-22T10:00:00Z", updatedAt: nil),
		]
		let view = ChatSessionsSidebar(
			sessions: sessions,
			selectedSessionId: nil,
			isLoading: false,
			isSessionsLoading: false,
			onSelectSession: { _ in },
			onDeleteSession: { _ in }
		)
		let buttons = try view.inspect().findAll(ViewType.Button.self)
		let sessionButton = buttons.first { btn in
			(try? btn.find(text: "Dated Session")) != nil
		}
		try #require(sessionButton != nil, "Session button not found")
		let texts = sessionButton!.findAll(ViewType.Text.self)
		let subtitleTexts = texts.compactMap { try? $0.string() }.filter { $0.contains("Jun") }
		#expect(subtitleTexts.count == 1)
		#expect(subtitleTexts[0].contains("2026"))
	}

	@Test("session with nil dates shows no subtitle text")
	func sessionWithNilDatesNoSubtitle() throws {
		let sessions = [
			SessionSummary(id: "1", name: "No Date Session", createdAt: nil, updatedAt: nil),
		]
		let view = ChatSessionsSidebar(
			sessions: sessions,
			selectedSessionId: nil,
			isLoading: false,
			isSessionsLoading: false,
			onSelectSession: { _ in },
			onDeleteSession: { _ in }
		)
		let buttons = try view.inspect().findAll(ViewType.Button.self)
		let sessionButton = buttons.first { btn in
			(try? btn.find(text: "No Date Session")) != nil
		}
		try #require(sessionButton != nil, "Session button not found")
		let texts = sessionButton!.findAll(ViewType.Text.self)
		#expect(texts.count == 1)
	}
}
