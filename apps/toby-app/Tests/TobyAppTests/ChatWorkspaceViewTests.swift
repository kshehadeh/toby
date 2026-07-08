import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("ChatWorkspaceView")
struct ChatWorkspaceViewTests {

    // MARK: - Empty state

    @Test("shows prompt headline when transcript is empty")
    func showsEmptyStateHeadline() throws {
        let store = ChatStore()
        let view = ChatWorkspaceView(store: store)
        #expect(throws: Never.self) {
            try view.inspect().find(text: "What should Toby take care of?")
        }
    }

    @Test("shows input dock in empty state")
    func showsInputDockInEmptyState() throws {
        let store = ChatStore()
        let view = ChatWorkspaceView(store: store)
        #expect(throws: Never.self) {
            try view.inspect().find(ViewType.TextField.self)
        }
    }

    @Test("shows suggestion buttons in empty state")
    func showsSuggestionButtonsInEmptyState() throws {
        let store = ChatStore()
        let view = ChatWorkspaceView(store: store)
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        let suggestionButtons = buttons.filter { btn in
            (try? btn.find(text: "Show me today's calendar and conflicts")) != nil
                || (try? btn.find(text: "Summarize unread mail that needs a reply")) != nil
                || (try? btn.find(text: "Create a recurring schedule for my weekly review")) != nil
                || (try? btn.find(text: "Find open tasks that are blocked or stale")) != nil
                || (try? btn.find(text: "Turn on Focus and minimize distracting windows")) != nil
        }
        #expect(!suggestionButtons.isEmpty)
    }

    @Test("hides suggestion buttons in active state")
    func hidesSuggestionButtonsInActiveState() throws {
        let store = ChatStore()
        store.transcript = [.user(text: "Hello")]
        let view = ChatWorkspaceView(store: store)
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        let suggestionButtons = buttons.filter { btn in
            (try? btn.find(text: "Show me today's calendar and conflicts")) != nil
                || (try? btn.find(text: "Summarize unread mail that needs a reply")) != nil
                || (try? btn.find(text: "Find open tasks that are blocked or stale")) != nil
        }
        #expect(suggestionButtons.isEmpty)
    }

    // MARK: - Active state

    @Test("shows input dock in active state")
    func showsInputDockInActiveState() throws {
        let store = ChatStore()
        store.transcript = [.user(text: "Hello"), .assistant(text: "Hi there")]
        let view = ChatWorkspaceView(store: store)
        #expect(throws: Never.self) {
            try view.inspect().find(ViewType.TextField.self)
        }
    }

    @Test("hides empty state headline when transcript has entries")
    func hidesEmptyHeadlineWhenTranscriptNotEmpty() throws {
        let store = ChatStore()
        store.transcript = [.user(text: "Hello")]
        let view = ChatWorkspaceView(store: store)
        #expect(throws: (any Error).self) {
            try view.inspect().find(text: "What should Toby take care of?")
        }
    }

    // MARK: - Prompt text

    @Test("prompt text binding reflects store state")
    func promptTextBinding() throws {
        let store = ChatStore()
        store.promptText = "Draft message"
        let view = ChatWorkspaceView(store: store)
        let field = try view.inspect().find(ViewType.TextField.self)
        #expect(try field.input() == "Draft message")
    }
}
