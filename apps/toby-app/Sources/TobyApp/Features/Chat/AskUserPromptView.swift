import SwiftUI

/// Interactive ask-user control rendered inline in the chat transcript.
/// Matches the layout of `AskUserQARow` so the answered Q&A can replace it in place.
struct AskUserPromptView: View {
	@Bindable var store: ChatStore

	var body: some View {
		if let prompt = store.activeAskUserPrompt {
			HStack(alignment: .top, spacing: 10) {
				AssistantRailColumn(iconName: "questionmark.bubble")
				VStack(alignment: .leading, spacing: 10) {
					Text(prompt.query)
						.font(AppTheme.transcriptCalloutFont.weight(.semibold))
						.foregroundStyle(AppTheme.primaryText)
						.fixedSize(horizontal: false, vertical: true)
						.frame(maxWidth: .infinity, alignment: .leading)

					VStack(spacing: 8) {
						ForEach(Array(prompt.options.enumerated()), id: \.offset) { index, option in
							Button {
								store.submitAskUserOption(index: index)
							} label: {
								AskUserOptionRow(number: index + 1, label: option)
							}
							.buttonStyle(.plain)
							.accessibilityIdentifier("ask-user-option-\(index)")
						}
						AskUserCustomOptionRow(store: store, number: prompt.options.count + 1)
					}

					Button {
						store.cancelAskUserPrompt()
					} label: {
						Text("Cancel")
							.font(AppTheme.transcriptCalloutFont.weight(.medium))
							.foregroundStyle(AppTheme.secondaryText)
					}
					.buttonStyle(.plain)
					.accessibilityIdentifier("ask-user-cancel")
				}
				.frame(maxWidth: 520, alignment: .leading)
				Spacer(minLength: 0)
			}
			.accessibilityElement(children: .contain)
			.accessibilityIdentifier("ask-user-prompt")
		}
	}
}
