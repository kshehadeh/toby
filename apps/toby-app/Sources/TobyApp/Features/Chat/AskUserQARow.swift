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
					.tracking(AppTheme.transcriptTracking)
					.lineSpacing(AppTheme.transcriptLineSpacing)
					.foregroundStyle(AppTheme.primaryText)
				if let error {
					Text(error)
						.font(AppTheme.transcriptCalloutFont)
						.tracking(AppTheme.transcriptTracking)
						.lineSpacing(AppTheme.transcriptLineSpacing)
						.foregroundStyle(.red)
						.textSelection(.enabled)
				} else {
					Text(answer)
						.font(AppTheme.transcriptCalloutFont)
						.tracking(AppTheme.transcriptTracking)
						.lineSpacing(AppTheme.transcriptLineSpacing)
						.foregroundStyle(AppTheme.secondaryText)
						.textSelection(.enabled)
				}
			}
			.frame(maxWidth: 520, alignment: .leading)
			Spacer(minLength: 0)
		}
	}
}
