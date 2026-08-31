import AppKit
import SwiftUI

struct OverlayHeightPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 126
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

struct SessionTitleBadge: View {
    let title: String
    let activityLine: String

    var body: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.headline.weight(.semibold))
                .foregroundStyle(AppTheme.primaryText)
                .lineLimit(1)
                .layoutPriority(1)
            if !activityLine.isEmpty {
                Text(activityLine)
                    .font(.caption)
                    .foregroundStyle(AppTheme.tertiaryText)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .padding(.horizontal, 2)
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct EmptyChatWorkspace: View {
    @Bindable var store: ChatStore
    let promptFocus: FocusState<Bool>.Binding
    var projectName: String?
    var allowsProjectFileAttachments = false

    private var greetingName: String {
        store.draftPersonaName ?? store.status?.persona ?? "Toby"
    }

    private var headline: String {
        if let projectName {
            return "New \(projectName) Chat"
        }
        return "What should \(greetingName) take care of?"
    }

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            VStack(spacing: 14) {
                if let projectName, let personaImageUrl = store.resolvedPersonaImageUrl {
                    ProjectChatWelcomeAvatar(
                        projectName: projectName,
                        personaName: greetingName,
                        personaImageUrl: personaImageUrl,
                    )
                } else if let personaImageUrl = store.resolvedPersonaImageUrl {
                    PersonaImageView(url: personaImageUrl, size: 96)
                        .accessibilityLabel("\(greetingName) persona")
                }
                VStack(spacing: 8) {
                    Text(headline)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(AppTheme.primaryText)
                    Text("Use your connected apps, schedules, memory, and Mac controls from one place.")
                        .font(.callout)
                        .foregroundStyle(AppTheme.secondaryText)
                        .multilineTextAlignment(.center)
                }
            }
            InputDock(
                text: $store.promptText,
                focus: promptFocus,
                isLoading: store.isLoading,
                contextFillPercentage: store.contextFillPercentage,
                contextWindowUnavailable: store.contextWindowUnavailable,
                attachments: store.pendingAttachments,
                canAttachFiles: store.canAttachFiles || allowsProjectFileAttachments,
                attachmentDisabledReason: allowsProjectFileAttachments
                    ? "Add files to save to this project"
                    : store.attachmentUnavailableReason,
                onAttachFiles: {
                    store.addAttachmentFiles(
                        $0,
                        allowProjectFileAttachments: allowsProjectFileAttachments
                    )
                },
                onRemoveAttachment: { store.removeAttachment(id: $0) },
                onSubmit: submit,
                onCancel: { store.cancelActiveTurn() },
            )
            EmptySuggestionList { suggestion in
                store.promptText = suggestion
            }
            Spacer()
        }
        .padding(.horizontal, AppTheme.contentPadding)
    }

    private func submit() {
        Task {
            await store.submitPrompt(
                saveAttachmentsToProject: allowsProjectFileAttachments
            )
        }
    }
}

struct ProjectChatWelcomeAvatar: View {
    let projectName: String
    let personaName: String
    let personaImageUrl: URL

    var body: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(AppTheme.accent.opacity(0.16))
            .frame(width: 96, height: 96)
            .overlay {
                Image(systemName: "folder.fill")
                    .font(.system(size: 44, weight: .semibold))
                    .foregroundStyle(AppTheme.accent)
                    .accessibilityHidden(true)
            }
            .overlay(alignment: .bottomTrailing) {
                PersonaImageView(url: personaImageUrl, size: 36)
                    .overlay {
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(AppTheme.contentBackground, lineWidth: 3)
                    }
                    .offset(x: 6, y: 6)
            }
            .frame(width: 108, height: 108)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(projectName) project chat with \(personaName)")
    }
}

struct ActiveChatWorkspace: View {
    @Bindable var store: ChatStore
    let promptFocus: FocusState<Bool>.Binding
    var allowsProjectFileAttachments = false
    @State private var overlayHeight: CGFloat = 126

    var body: some View {
        ZStack(alignment: .bottom) {
            TranscriptView(
                entries: store.transcript,
                streamingAssistant: store.streamingAssistant,
                isLoading: store.isLoading,
                turnWorkDurations: store.turnWorkDurations,
                activeWorkStartDate: store.activeWorkStartDate,
                bottomContentPadding: overlayHeight,
                personaImageUrl: store.resolvedPersonaImageUrl,
                askUserStore: store,
            )
            VStack(spacing: 8) {
                InputDock(
                    text: $store.promptText,
                    focus: promptFocus,
                    isLoading: store.isLoading,
                    contextFillPercentage: store.contextFillPercentage,
                    contextWindowUnavailable: store.contextWindowUnavailable,
                    attachments: store.pendingAttachments,
                    canAttachFiles: store.canAttachFiles || allowsProjectFileAttachments,
                    attachmentDisabledReason: allowsProjectFileAttachments
                        ? "Add files to save to this project"
                        : store.attachmentUnavailableReason,
                    onAttachFiles: {
                        store.addAttachmentFiles(
                            $0,
                            allowProjectFileAttachments: allowsProjectFileAttachments
                        )
                    },
                    onRemoveAttachment: { store.removeAttachment(id: $0) },
                    onSubmit: submit,
                    onCancel: { store.cancelActiveTurn() },
                )
            }
            .padding(.horizontal, AppTheme.contentPadding)
            .padding(.bottom, 18)
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(
                        key: OverlayHeightPreferenceKey.self,
                        value: proxy.size.height
                    )
                }
            )
        }
        .onPreferenceChange(OverlayHeightPreferenceKey.self) { newValue in
            // Ignore sub-pixel thrash that can re-layout the transcript endlessly.
            guard abs(newValue - overlayHeight) > 0.5 else { return }
            overlayHeight = newValue
        }
    }

    private func submit() {
        Task {
            await store.submitPrompt(
                saveAttachmentsToProject: allowsProjectFileAttachments
            )
        }
    }
}

struct EmptySuggestionList: View {
    let onSelect: (String) -> Void

    private let suggestions = [
        "Show me today’s calendar and conflicts",
        "Summarize unread mail that needs a reply",
        "Create a recurring schedule for my weekly review",
        "Find open tasks that are blocked or stale",
        "Turn on Focus and minimize distracting windows",
    ]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(suggestions, id: \.self) { suggestion in
                Button {
                    onSelect(suggestion)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: iconName(for: suggestion))
                            .accessibilityLabel(Text(suggestion))
                            .foregroundStyle(AppTheme.tertiaryText)
                            .frame(width: 16)
                        Text(suggestion)
                            .font(.callout)
                            .foregroundStyle(AppTheme.secondaryText)
                            .lineLimit(1)
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(AppTheme.separator)
                        .frame(height: 1)
                }
            }
        }
    }

    private func iconName(for suggestion: String) -> String {
        if suggestion.localizedCaseInsensitiveContains("calendar") {
            return "calendar"
        }
        if suggestion.localizedCaseInsensitiveContains("mail") {
            return "envelope"
        }
        if suggestion.localizedCaseInsensitiveContains("schedule") {
            return "clock"
        }
        if suggestion.localizedCaseInsensitiveContains("tasks") {
            return "checklist"
        }
        return "macwindow"
    }
}
