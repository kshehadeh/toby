import SwiftUI

struct ChatWorkspaceView: View {
	@Bindable var store: ChatStore
	@FocusState private var isPromptFocused: Bool

	var body: some View {
		VStack(spacing: 0) {
			ChatTopBar(sessionName: store.sessionName, activityLine: store.activityLine)
			if store.transcript.isEmpty && store.streamingAssistant == nil {
				EmptyChatWorkspace(store: store, promptFocus: $isPromptFocused)
			} else {
				ActiveChatWorkspace(store: store, promptFocus: $isPromptFocused)
			}
		}
		.background(AppTheme.contentBackground)
		.ignoresSafeArea(.container, edges: .top)
		.onChange(of: store.promptFocusRequestId) { _, _ in
			isPromptFocused = true
		}
	}
}

private struct ChatTopBar: View {
	let sessionName: String
	let activityLine: String

	var body: some View {
		HStack(spacing: 12) {
			SessionTitleBadge(title: sessionName)
			if !activityLine.isEmpty {
				Text(activityLine)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer()
		}
		.padding(.horizontal, AppTheme.contentPadding)
		.padding(.top, 8)
		.padding(.bottom, 8)
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

private struct SessionTitleBadge: View {
	let title: String

	var body: some View {
		Text(title)
			.font(.headline.weight(.semibold))
			.foregroundStyle(AppTheme.primaryText)
			.lineLimit(1)
			.padding(.horizontal, 14)
			.padding(.vertical, 8)
			.background(
				Capsule()
					.fill(AppTheme.elevatedBackground.opacity(0.62)),
			)
			.overlay(
				Capsule()
					.stroke(Color.white.opacity(0.12), lineWidth: 1),
			)
	}
}

private struct EmptyChatWorkspace: View {
	@Bindable var store: ChatStore
	let promptFocus: FocusState<Bool>.Binding

	var body: some View {
		VStack(spacing: 18) {
			Spacer()
			VStack(spacing: 8) {
				Text("What should Toby take care of?")
					.font(.title2.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				Text("Use your connected apps, schedules, memory, and Mac controls from one place.")
					.font(.callout)
					.foregroundStyle(AppTheme.secondaryText)
					.multilineTextAlignment(.center)
			}
			InputDock(
				text: $store.promptText,
				focus: promptFocus,
				isLoading: store.isLoading,
				onSubmit: submit,
			)
			.frame(maxWidth: 620)
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

private struct ActiveChatWorkspace: View {
	@Bindable var store: ChatStore
	let promptFocus: FocusState<Bool>.Binding
	private let promptOverlayBottomPadding: CGFloat = 126

	var body: some View {
		ZStack(alignment: .bottom) {
			TranscriptView(
				entries: store.transcript,
				streamingAssistant: store.streamingAssistant,
				isLoading: store.isLoading,
				turnWorkDurations: store.turnWorkDurations,
				activeWorkStartDate: store.activeWorkStartDate,
				bottomContentPadding: promptOverlayBottomPadding,
			)
			VStack(spacing: 8) {
				if let errorMessage = store.errorMessage {
					ErrorBanner(message: errorMessage) {
						store.dismissError()
					}
				}
				InputDock(
					text: $store.promptText,
					focus: promptFocus,
					isLoading: store.isLoading,
					onSubmit: submit,
				)
			}
			.padding(.horizontal, AppTheme.contentPadding)
			.padding(.bottom, 18)
		}
	}

	private func submit() {
		Task { await store.submitPrompt() }
	}
}

private struct ErrorBanner: View {
	let message: String
	let onDismiss: () -> Void

	var body: some View {
		HStack(alignment: .center, spacing: 10) {
			Image(systemName: "exclamationmark.triangle.fill")
				.font(.caption.weight(.semibold))
				.foregroundStyle(Color.white.opacity(0.92))
			Text(message)
				.font(.caption)
				.foregroundStyle(Color.white.opacity(0.95))
				.lineLimit(3)
				.fixedSize(horizontal: false, vertical: true)
				.frame(maxWidth: .infinity, alignment: .leading)
			Button(action: onDismiss) {
				Image(systemName: "xmark")
					.font(.caption.weight(.bold))
					.foregroundStyle(Color.white.opacity(0.85))
					.frame(width: 22, height: 22)
					.contentShape(Circle())
			}
			.buttonStyle(.plain)
			.help("Dismiss error")
		}
		.padding(.horizontal, 12)
		.padding(.vertical, 9)
		.background(
			Capsule(style: .continuous)
				.fill(Color.red.opacity(0.78))
		)
		.overlay {
			Capsule(style: .continuous)
				.stroke(Color.white.opacity(0.12), lineWidth: 1)
		}
		.shadow(color: Color.black.opacity(0.20), radius: 10, y: 4)
	}
}

private struct EmptySuggestionList: View {
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
		.frame(maxWidth: 620)
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
