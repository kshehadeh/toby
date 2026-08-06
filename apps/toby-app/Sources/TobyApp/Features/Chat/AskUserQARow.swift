import AppKit
import SwiftUI

struct AskUserQARow: View {
	let query: String
	let answer: String
	let error: String?

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			AssistantRailColumn(iconName: "questionmark.bubble")
			VStack(alignment: .leading, spacing: 6) {
				Text(query)
					.font(AppTheme.transcriptCalloutFont.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				if let error {
					InlineStatusMessage(
						message: error,
						tone: .error,
						font: AppTheme.transcriptCalloutFont,
						allowsTextSelection: true
					)
				} else {
					Text(answer)
						.font(AppTheme.transcriptCalloutFont)
						.foregroundStyle(AppTheme.secondaryText)
						.textSelection(.enabled)
				}
			}
			.frame(maxWidth: 520, alignment: .leading)
			Spacer(minLength: 0)
		}
	}
}
