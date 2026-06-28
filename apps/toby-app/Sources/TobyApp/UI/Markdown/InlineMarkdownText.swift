import SwiftUI

struct InlineMarkdownText: View {
	let text: String

	var body: some View {
		if let attributed = parsedMarkdown {
			Text(attributed)
				.textSelection(.enabled)
		} else {
			Text(text)
				.textSelection(.enabled)
		}
	}

	private var parsedMarkdown: AttributedString? {
		try? AttributedString(
			markdown: text,
			options: AttributedString.MarkdownParsingOptions(
				interpretedSyntax: .inlineOnlyPreservingWhitespace,
				failurePolicy: .returnPartiallyParsedIfPossible,
			),
		)
	}
}

extension Array {
	subscript(safe index: Int) -> Element? {
		indices.contains(index) ? self[index] : nil
	}
}

extension TextAlignment {
	var alignment: Alignment {
		switch self {
		case .leading: return .leading
		case .center: return .center
		case .trailing: return .trailing
		@unknown default: return .leading
		}
	}

	var unitPoint: UnitPoint {
		switch self {
		case .leading: return .topLeading
		case .center: return .top
		case .trailing: return .topTrailing
		@unknown default: return .topLeading
		}
	}

	var zstackAlignment: Alignment {
		switch self {
		case .leading: return .topLeading
		case .center: return .top
		case .trailing: return .topTrailing
		@unknown default: return .topLeading
		}
	}
}
