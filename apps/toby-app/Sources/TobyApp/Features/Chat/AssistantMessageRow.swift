import SwiftUI

struct AssistantMessageRow: View {
	let messageBody: String
	let isStreaming: Bool
	var createdAt: String? = nil

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			MarkdownText(
				text: messageBody,
				font: AppTheme.transcriptAnswerFont,
				foregroundStyle: AppTheme.primaryText,
				usesProseTypography: true,
			)
			.lineSpacing(AppTheme.transcriptAnswerLineSpacing)
			.frame(maxWidth: .infinity, alignment: .leading)
			if !isStreaming {
				TranscriptMessageActions(
					copyText: messageBody,
					copyLabel: "Copy response",
					createdAt: createdAt,
				)
			}
		}
		.frame(maxWidth: AppTheme.transcriptReadingWidth, alignment: .leading)
		.accessibilityIdentifier("assistant-message-row")
	}
}
