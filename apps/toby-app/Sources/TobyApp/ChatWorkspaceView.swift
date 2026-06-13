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
			Image(systemName: "ellipsis")
				.foregroundStyle(AppTheme.secondaryText)
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
			Text("What should we build in toby?")
				.font(.title2)
				.foregroundStyle(AppTheme.primaryText)
			InputDock(
				text: $store.promptText,
				isLoading: store.isLoading,
				onSubmit: submit,
			)
			.frame(maxWidth: 620)
			EmptySuggestionList()
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
	private let suggestions = [
		"Show me today’s agenda",
		"Summarize my open tasks",
		"Find time for deep work this week",
	]

	var body: some View {
		VStack(spacing: 0) {
			ForEach(suggestions, id: \.self) { suggestion in
				HStack(spacing: 10) {
					Image(systemName: "sparkles")
						.foregroundStyle(AppTheme.tertiaryText)
					Text(suggestion)
						.font(.callout)
						.foregroundStyle(AppTheme.secondaryText)
					Spacer()
				}
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
}
