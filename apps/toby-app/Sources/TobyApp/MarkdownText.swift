import SwiftUI

struct MarkdownText: View {
	let text: String
	let font: Font
	let foregroundStyle: Color

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
				switch block {
				case .heading(let level, let content):
					InlineMarkdownText(text: content)
						.font(level == 2 ? .title3 : .headline)
						.bold()
						.foregroundStyle(AppTheme.primaryText)
				case .paragraph(let content):
					InlineMarkdownText(text: content)
						.font(font)
						.foregroundStyle(foregroundStyle)
				case .bullet(let content):
					HStack(alignment: .firstTextBaseline, spacing: 8) {
						Text("•")
							.font(font)
							.foregroundStyle(foregroundStyle)
						InlineMarkdownText(text: content)
							.font(font)
							.foregroundStyle(foregroundStyle)
					}
				case .code(let content):
					ScrollView(.horizontal, showsIndicators: false) {
						Text(content)
							.font(.system(.callout, design: .monospaced))
							.foregroundStyle(foregroundStyle)
							.textSelection(.enabled)
					}
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var blocks: [MarkdownBlock] {
		var output: [MarkdownBlock] = []
		var paragraph: [String] = []
		var code: [String] = []
		var inFence = false

		func flushParagraph() {
			guard !paragraph.isEmpty else { return }
			output.append(.paragraph(paragraph.joined(separator: "\n")))
			paragraph.removeAll()
		}

		func flushCode() {
			guard !code.isEmpty else { return }
			output.append(.code(code.joined(separator: "\n")))
			code.removeAll()
		}

		for rawLine in text.components(separatedBy: .newlines) {
			let line = rawLine.trimmingCharacters(in: .whitespaces)
			if line.hasPrefix("```") {
				if inFence {
					flushCode()
					inFence = false
				} else {
					flushParagraph()
					inFence = true
				}
				continue
			}
			if inFence {
				code.append(rawLine)
				continue
			}
			if line.isEmpty {
				flushParagraph()
				continue
			}
			if line.hasPrefix("|") && line.hasSuffix("|") {
				flushParagraph()
				output.append(.code(rawLine))
				continue
			}
			if line.hasPrefix("### ") {
				flushParagraph()
				output.append(.heading(level: 3, content: String(line.dropFirst(4))))
				continue
			}
			if line.hasPrefix("## ") {
				flushParagraph()
				output.append(.heading(level: 2, content: String(line.dropFirst(3))))
				continue
			}
			if line.hasPrefix("# ") {
				flushParagraph()
				output.append(.heading(level: 1, content: String(line.dropFirst(2))))
				continue
			}
			if line.hasPrefix("- ") {
				flushParagraph()
				output.append(.bullet(String(line.dropFirst(2))))
				continue
			}
			paragraph.append(rawLine)
		}

		flushParagraph()
		flushCode()
		return output.isEmpty ? [.paragraph(text)] : output
	}

	private enum MarkdownBlock {
		case heading(level: Int, content: String)
		case paragraph(String)
		case bullet(String)
		case code(String)
	}
}

private struct InlineMarkdownText: View {
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
