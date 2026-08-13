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

    private var greetingName: String {
        store.draftPersonaName ?? store.status?.persona ?? "Toby"
    }

    private var appIcon: Image {
        if let logoURL = Bundle.tobyResources.url(forResource: "toby-128", withExtension: "png"),
            let nsImage = NSImage(contentsOf: logoURL)
        {
            // Full-color logo art (not an alpha glyph) — do not mark as template.
            nsImage.isTemplate = false
            return Image(nsImage: nsImage)
        }
        return Image(systemName: "brain.head.profile")
    }

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            VStack(spacing: 14) {
                appIcon
                    .resizable()
                    .interpolation(.high)
                    .antialiased(true)
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 96, height: 96)
                VStack(spacing: 8) {
                    Text("What should \(greetingName) take care of?")
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
                canAttachFiles: store.canAttachFiles,
                attachmentDisabledReason: store.attachmentUnavailableReason,
                onAttachFiles: { store.addAttachmentFiles($0) },
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
        Task { await store.submitPrompt() }
    }
}

struct ActiveChatWorkspace: View {
    @Bindable var store: ChatStore
    let promptFocus: FocusState<Bool>.Binding
    @State private var overlayHeight: CGFloat = 126

    private var personaImageUrl: URL? {
        let urlString = store.sessionPersonaImageUrl ?? store.status?.personaImageUrl
        if let urlString {
            return URL(string: ConfigReader.baseURL().absoluteString + urlString)
        }
        return ConfigReader.baseURL().appendingPathComponent("api/personas/image/default.png")
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            TranscriptView(
                entries: store.transcript,
                streamingAssistant: store.streamingAssistant,
                isLoading: store.isLoading,
                turnWorkDurations: store.turnWorkDurations,
                activeWorkStartDate: store.activeWorkStartDate,
                bottomContentPadding: overlayHeight,
                personaImageUrl: personaImageUrl,
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
                    canAttachFiles: store.canAttachFiles,
                    attachmentDisabledReason: store.attachmentUnavailableReason,
                    onAttachFiles: { store.addAttachmentFiles($0) },
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
        Task { await store.submitPrompt() }
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
