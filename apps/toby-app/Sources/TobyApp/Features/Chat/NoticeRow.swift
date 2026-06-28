import AppKit
import SwiftUI

struct NoticeRow: View {
	let text: String
	let tone: String?

	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			Image(systemName: iconName)
				.font(AppTheme.transcriptCaptionFont)
				.foregroundStyle(AppTheme.tertiaryText)
				.frame(width: 14, alignment: .center)
				.padding(.top, 2)
			MarkdownText(text: text, font: AppTheme.transcriptCalloutFont, foregroundStyle: color)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(.vertical, 2)
	}

	private var iconName: String {
		if text.hasPrefix("Skills:") {
			return "sparkles"
		}
		if text.contains(" tools") || text.contains(" core tools") {
			return "wrench.and.screwdriver"
		}
		return "info.circle"
	}

	private var color: Color {
		switch tone {
		case "success":
			return .green
		case "error":
			return .red
		default:
			return AppTheme.secondaryText
		}
	}
}
