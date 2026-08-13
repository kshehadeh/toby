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

    @Test("empty headline uses the draft persona name")
    func emptyHeadlineUsesDraftPersona() throws {
        let store = ChatStore()
        store.draftPersonaName = "Mailman"
        let view = ChatWorkspaceView(store: store)
        #expect(throws: Never.self) {
            try view.inspect().find(text: "What should Mailman take care of?")
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

    // MARK: - Ask user (inline transcript control)

    @Test("renders ask-user prompt inline in the transcript, not as empty-state modal chrome")
    func showsAskUserPromptInline() throws {
        let store = ChatStore()
        store.transcript = [.user(text: "Schedule something")]
        store.activeAskUserPrompt = ActiveAskUserPrompt(
            id: "req-1",
            turnId: "turn-1",
            requestId: "req-1",
            query: "Which calendar should I use?",
            options: ["Personal", "Work"]
        )
        let view = ChatWorkspaceView(store: store)

        #expect(throws: Never.self) {
            try view.inspect().find(viewWithAccessibilityIdentifier: "ask-user-prompt")
        }
        #expect(throws: Never.self) {
            try view.inspect().find(text: "Which calendar should I use?")
        }
        #expect(throws: Never.self) {
            try view.inspect().find(text: "Personal")
        }
        #expect(throws: Never.self) {
            try view.inspect().find(text: "Work")
        }
        // Empty-state headline must not show while a turn is waiting on a choice.
        #expect(throws: (any Error).self) {
            try view.inspect().find(text: "What should Toby take care of?")
        }
    }

    @Test("renders answered ask-user Q&A in the transcript")
    func showsAskUserQAInTranscript() throws {
        let store = ChatStore()
        store.transcript = [
            .user(text: "Schedule something"),
            .askUserQA(
                blockKey: "b1",
                query: "Which calendar should I use?",
                answer: "Work",
                error: nil
            ),
        ]
        let view = ChatWorkspaceView(store: store)

        #expect(throws: Never.self) {
            try view.inspect().find(text: "Which calendar should I use?")
        }
        #expect(throws: Never.self) {
            try view.inspect().find(text: "Work")
        }
        #expect(throws: (any Error).self) {
            try view.inspect().find(viewWithAccessibilityIdentifier: "ask-user-prompt")
        }
    }
}
