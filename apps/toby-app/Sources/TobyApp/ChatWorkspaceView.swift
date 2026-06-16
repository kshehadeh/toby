import SwiftUI

struct ChatWorkspaceView: View {
	@Bindable var store: ChatStore

	var body: some View {
		VStack(spacing: 0) {
			ChatTopBar(sessionName: store.sessionName, activityLine: store.activityLine)
			if store.transcript.isEmpty && store.streamingAssistant == nil {
				EmptyChatWorkspace(store: store)
			} else {
				ActiveChatWorkspace(store: store)
			}
		}
		.background(AppTheme.contentBackground)
	}
}

private struct ChatTopBar: View {
	let sessionName: String
	let activityLine: String

	var body: some View {
		HStack(spacing: 10) {
			Text(sessionName)
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
				.lineLimit(1)
			Text(activityLine)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.lineLimit(1)
			Spacer()
		}
		.padding(.horizontal, AppTheme.contentPadding)
		.padding(.vertical, 14)
		.overlay(alignment: .bottom) {
			Rectangle()
				.fill(AppTheme.separator)
				.frame(height: 1)
		}
	}
}

private struct EmptyChatWorkspace: View {
	@Bindable var store: ChatStore

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

	var body: some View {
		VStack(spacing: 0) {
			TranscriptView(
				entries: store.transcript,
				streamingAssistant: store.streamingAssistant,
				isLoading: store.isLoading,
				turnWorkDurations: store.turnWorkDurations,
				activeWorkStartDate: store.activeWorkStartDate,
			)
			if let errorMessage = store.errorMessage {
				Text(errorMessage)
					.font(.caption)
					.foregroundStyle(.red)
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(.horizontal, AppTheme.contentPadding)
					.padding(.bottom, 8)
			}
			InputDock(
				text: $store.promptText,
				isLoading: store.isLoading,
				onSubmit: submit,
			)
			.padding(.horizontal, AppTheme.contentPadding)
			.padding(.bottom, 18)
		}
	}

	private func submit() {
		Task { await store.submitPrompt() }
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
