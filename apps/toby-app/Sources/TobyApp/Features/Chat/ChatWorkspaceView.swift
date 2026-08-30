import SwiftUI

struct ChatWorkspaceView: View {
    @Bindable var store: ChatStore
    var allowsProjectFileAttachments = false
    @FocusState private var isPromptFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            if store.transcript.isEmpty && store.streamingAssistant == nil && store.activeAskUserPrompt == nil {
                EmptyChatWorkspace(
                    store: store,
                    promptFocus: $isPromptFocused,
                    allowsProjectFileAttachments: allowsProjectFileAttachments
                )
            } else {
                ActiveChatWorkspace(
                    store: store,
                    promptFocus: $isPromptFocused,
                    allowsProjectFileAttachments: allowsProjectFileAttachments
                )
            }
        }
        .background(AppTheme.contentBackground)
        .defaultFocus($isPromptFocused, true)
        .task(id: store.promptFocusRequestId) {
            isPromptFocused = true
        }
    }
}
