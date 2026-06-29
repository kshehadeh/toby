import SwiftUI

struct ChatWorkspaceView: View {
    @Bindable var store: ChatStore
    @FocusState private var isPromptFocused: Bool

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                if store.transcript.isEmpty && store.streamingAssistant == nil {
                    EmptyChatWorkspace(store: store, promptFocus: $isPromptFocused)
                } else {
                    ActiveChatWorkspace(store: store, promptFocus: $isPromptFocused)
                }
            }
            .background(AppTheme.contentBackground)
            .onChange(of: store.promptFocusRequestId) { _, _ in
                isPromptFocused = true
            }

            if store.activeAskUserPrompt != nil {
                AskUserPromptView(store: store)
            }
        }
    }
}
