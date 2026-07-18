import SwiftUI

struct MarkdownTable: Equatable {
	let hasHeader: Bool
	let colCount: Int
	let cells: [[String]]
	let alignments: [TextAlignment]
}

enum MarkdownBlock: Equatable {
	case heading(level: Int, content: String)
	case paragraph(String)
	case bullet(String)
	case blockquote(String)
	case horizontalRule
	case code(String)
	case table(MarkdownTable)
}

struct MarkdownText: View {
	let text: String
	let font: Font
	let foregroundStyle: Color
	/// When set, bold/strong inline runs use this color while normal text uses `foregroundStyle`.
	var strongForegroundStyle: Color? = nil
	/// Heading color. Defaults to `foregroundStyle` (or primary when using standard styling).
	var headingForegroundStyle: Color? = nil
	/// When true, heading text is rendered in uppercase.
	var uppercaseHeadings: Bool = false

	/// Collapsed dashboard cards disable body interaction so sub-blocks cannot
	/// expand/reflow clipped text; only the card’s “Show more” grows layout.
	@Environment(\.dashboardCardBodyInteractive) private var bodyInteractive

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
				switch block {
				case .heading(let level, let content):
					let display = uppercaseHeadings ? content.uppercased() : content
					let headingColor = headingForegroundStyle ?? AppTheme.primaryText
					inlineText(display, base: headingColor, strong: headingColor)
						.font(headingFont(for: level))
						.fontWeight(.semibold)
				case .paragraph(let content):
					styledInline(content)
						.font(font)
				case .bullet(let content):
					HStack(alignment: .firstTextBaseline, spacing: 8) {
						Text("•")
							.font(font)
							.foregroundStyle(foregroundStyle)
						styledInline(content)
							.font(font)
					}
				case .blockquote(let content):
					HStack(alignment: .top, spacing: 10) {
						RoundedRectangle(cornerRadius: 1.5)
							.fill(AppTheme.separator)
							.frame(width: 3)
						styledInline(content, baseOpacity: 0.88)
							.font(font)
					}
					.accessibilityIdentifier("markdown-blockquote")
				case .horizontalRule:
					Divider()
						.overlay(AppTheme.separator)
						.padding(.vertical, 2)
						.accessibilityIdentifier("markdown-horizontal-rule")
				case .code(let content):
					ScrollView(.horizontal, showsIndicators: false) {
						let codeText = Text(content)
							.font(.system(.callout, design: .monospaced))
							.foregroundStyle(foregroundStyle)
						if bodyInteractive {
							codeText.textSelection(.enabled)
						} else {
							codeText.textSelection(.disabled)
						}
					}
				case .table(let table):
					TableGrid(
						table: table,
						font: font,
						foregroundStyle: foregroundStyle,
						strongForegroundStyle: strongForegroundStyle
					)
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		// When the hosting dashboard card is collapsed, ignore hits so individual
		// markdown sub-blocks cannot expand text inside the fixed-height clip.
		.allowsHitTesting(bodyInteractive)
	}

	private var blocks: [MarkdownBlock] {
		Self.parseBlocks(text)
	}

	private func headingFont(for level: Int) -> Font {
		if uppercaseHeadings {
			// Compact section labels (all-caps) for denser cards like the dashboard.
			switch level {
			case 1: return .system(size: 12, weight: .semibold)
			case 2: return .system(size: 11, weight: .semibold)
			default: return .system(size: 11, weight: .semibold)
			}
		}
		return level == 2 ? .title3 : .headline
	}

	@ViewBuilder
	private func styledInline(_ content: String, baseOpacity: Double = 1) -> some View {
		if let strong = strongForegroundStyle {
			let base = foregroundStyle.opacity(baseOpacity)
			inlineText(content, base: base, strong: strong.opacity(baseOpacity))
		} else {
			InlineMarkdownText(text: content)
				.foregroundStyle(foregroundStyle.opacity(baseOpacity))
		}
	}

	private func inlineText(_ content: String, base: Color, strong: Color) -> InlineMarkdownText {
		InlineMarkdownText(text: content, baseForeground: base, strongForeground: strong)
	}

	static func parseBlocks(_ text: String) -> [MarkdownBlock] {
		var output: [MarkdownBlock] = []
		var paragraph: [String] = []
		var code: [String] = []
		var tableRows: [String] = []
		var blockquote: [String] = []
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

		func flushTable() {
			guard !tableRows.isEmpty else { return }
			if let table = parseTable(tableRows) {
				output.append(.table(table))
			} else {
				output.append(.code(tableRows.joined(separator: "\n")))
			}
			tableRows.removeAll()
		}

		func flushBlockquote() {
			guard !blockquote.isEmpty else { return }
			output.append(.blockquote(blockquote.joined(separator: "\n")))
			blockquote.removeAll()
		}

		for rawLine in text.components(separatedBy: .newlines) {
			let line = rawLine.trimmingCharacters(in: .whitespaces)
			if line.hasPrefix("```") {
				flushTable()
				if inFence {
					flushCode()
					inFence = false
				} else {
					flushParagraph()
					flushBlockquote()
					inFence = true
				}
				continue
			}
			if inFence {
				code.append(rawLine)
				continue
			}
			if line.isEmpty {
				flushTable()
				flushParagraph()
				flushBlockquote()
				continue
			}
			if isTableLine(line) {
				flushParagraph()
				flushCode()
				flushBlockquote()
				tableRows.append(line)
				continue
			}
			flushTable()
			if isHorizontalRuleLine(line) {
				flushParagraph()
				flushBlockquote()
				output.append(.horizontalRule)
				continue
			}
			if line.hasPrefix(">") {
				flushParagraph()
				let content = String(line.dropFirst())
					.trimmingCharacters(in: .whitespaces)
				blockquote.append(content)
				continue
			}
			flushBlockquote()
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

		flushTable()
		flushParagraph()
		flushBlockquote()
		flushCode()
		return output.isEmpty ? [.paragraph(text)] : output
	}

	private static func isTableLine(_ line: String) -> Bool {
		line.hasPrefix("|") && line.hasSuffix("|")
	}

	private static func isHorizontalRuleLine(_ line: String) -> Bool {
		let trimmed = line.trimmingCharacters(in: .whitespaces)
		return trimmed.count >= 3 && trimmed.allSatisfy { $0 == "-" }
	}

	private static func isTableSeparatorLine(_ line: String) -> Bool {
		let cells = parseTableCells(line)
		let pattern = try? NSRegularExpression(pattern: "^:?-+:?$", options: [])
		return cells.allSatisfy { cell in
			let trimmed = cell.trimmingCharacters(in: .whitespaces)
			let range = NSRange(location: 0, length: trimmed.utf16.count)
			return pattern?.firstMatch(in: trimmed, options: [], range: range) != nil
		}
	}

	private static func parseTableCells(_ line: String) -> [String] {
		line
			.trimmingCharacters(in: .whitespaces)
			.trimmingCharacters(in: CharacterSet(charactersIn: "|"))
			.components(separatedBy: "|")
			.map { $0.trimmingCharacters(in: .whitespaces) }
	}

	private static func parseTable(_ lines: [String]) -> MarkdownTable? {
		guard !lines.isEmpty else { return nil }
		let rows = lines.map { parseTableCells($0) }
		let colCount = rows.map(\.count).max() ?? 0
		guard colCount > 0 else { return nil }

		let normalized = rows.map { row -> [String] in
			var row = row
			if row.count < colCount {
				row.append(contentsOf: Array(repeating: "", count: colCount - row.count))
			} else if row.count > colCount {
				row = Array(row.prefix(colCount))
			}
			return row
		}

		var alignments = Array(repeating: TextAlignment.leading, count: colCount)
		var hasHeader = false
		var cells = normalized

		if lines.count >= 2 && isTableSeparatorLine(lines[1]) {
			hasHeader = true
			let separator = normalized[1]
			for (index, cell) in separator.enumerated() {
				let trimmed = cell.trimmingCharacters(in: .whitespaces)
				if trimmed.hasPrefix(":") && trimmed.hasSuffix(":") {
					alignments[index] = .center
				} else if trimmed.hasSuffix(":") {
					alignments[index] = .trailing
				} else if trimmed.hasPrefix(":") {
					alignments[index] = .leading
				}
			}
			cells = [normalized[0]] + Array(normalized.dropFirst(2))
		}

		return MarkdownTable(hasHeader: hasHeader, colCount: colCount, cells: cells, alignments: alignments)
	}
}
