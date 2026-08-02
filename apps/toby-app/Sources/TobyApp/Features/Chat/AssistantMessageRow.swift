import AppKit
import SwiftUI

struct AssistantMessageRow: View {
	let iconName: String
	let header: String
	let messageBody: String
	let isStreaming: Bool
	var personaImage: URL? = nil

	var body: some View {
		HStack(alignment: .top, spacing: 10) {
			AssistantRailColumn(iconName: iconName, personaImage: personaImage)
			VStack(alignment: .leading, spacing: 6) {
				Text(header)
					.font(AppTheme.transcriptCaptionFont.weight(.semibold))
					.foregroundStyle(AppTheme.secondaryText)
				MarkdownText(
					text: messageBody,
					font: AppTheme.transcriptAnswerFont,
					foregroundStyle: AppTheme.primaryText,
				)
				.lineSpacing(AppTheme.transcriptAnswerLineSpacing)
				.frame(maxWidth: .infinity, alignment: .leading)
				if isStreaming {
					ProgressView()
						.controlSize(.small)
				} else if !messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
					HStack {
						CopyButton(text: messageBody, label: "Copy response")
						Spacer(minLength: 0)
					}
					.padding(.top, 2)
				}
			}
			.frame(maxWidth: 640, alignment: .leading)
			Spacer(minLength: 0)
		}
	}
}
