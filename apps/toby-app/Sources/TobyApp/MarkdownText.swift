import SwiftUI

private struct MarkdownTable {
	let hasHeader: Bool
	let colCount: Int
	let cells: [[String]]
	let alignments: [TextAlignment]
}

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
				case .table(let table):
					TableGrid(table: table, font: font, foregroundStyle: foregroundStyle)
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	private var blocks: [MarkdownBlock] {
		var output: [MarkdownBlock] = []
		var paragraph: [String] = []
		var code: [String] = []
		var tableRows: [String] = []
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

		for rawLine in text.components(separatedBy: .newlines) {
			let line = rawLine.trimmingCharacters(in: .whitespaces)
			if line.hasPrefix("```") {
				flushTable()
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
				flushTable()
				flushParagraph()
				continue
			}
			if isTableLine(line) {
				flushParagraph()
				flushCode()
				tableRows.append(line)
				continue
			}
			flushTable()
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
		flushCode()
		return output.isEmpty ? [.paragraph(text)] : output
	}

	private enum MarkdownBlock {
		case heading(level: Int, content: String)
		case paragraph(String)
		case bullet(String)
		case code(String)
		case table(MarkdownTable)
	}

	private func isTableLine(_ line: String) -> Bool {
		line.hasPrefix("|") && line.hasSuffix("|")
	}

	private func isTableSeparatorLine(_ line: String) -> Bool {
		let cells = parseTableCells(line)
		let pattern = try? NSRegularExpression(pattern: "^:?-+:?$", options: [])
		return cells.allSatisfy { cell in
			let trimmed = cell.trimmingCharacters(in: .whitespaces)
			let range = NSRange(location: 0, length: trimmed.utf16.count)
			return pattern?.firstMatch(in: trimmed, options: [], range: range) != nil
		}
	}

	private func parseTableCells(_ line: String) -> [String] {
		line
			.trimmingCharacters(in: .whitespaces)
			.trimmingCharacters(in: CharacterSet(charactersIn: "|"))
			.components(separatedBy: "|")
			.map { $0.trimmingCharacters(in: .whitespaces) }
	}

	private func parseTable(_ lines: [String]) -> MarkdownTable? {
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

private struct TableGrid: View {
	let table: MarkdownTable
	let font: Font
	let foregroundStyle: Color

	var body: some View {
		ScrollView(.horizontal) {
			Grid(alignment: .top, horizontalSpacing: 0, verticalSpacing: 0) {
				ForEach(Array(table.cells.enumerated()), id: \.offset) { rowIndex, row in
					let isHeader = table.hasHeader && rowIndex == 0
					GridRow {
						ForEach(Array(row.enumerated()), id: \.offset) { colIndex, cell in
							let alignment = table.alignments[safe: colIndex] ?? .leading
							InlineMarkdownText(text: cell)
								.font(font)
								.bold(isHeader)
								.foregroundStyle(foregroundStyle)
								.multilineTextAlignment(alignment)
								.padding(.horizontal, 12)
								.padding(.vertical, 8)
								.frame(maxWidth: .infinity, alignment: alignment.alignment)
						}
					}
					.background(isHeader ? AppTheme.elevatedBackground.opacity(0.5) : Color.clear)
					if rowIndex != table.cells.count - 1 {
						GridRow {
							Divider()
								.foregroundStyle(AppTheme.separator)
								.gridCellColumns(table.colCount)
						}
					}
				}
			}
			.fixedSize(horizontal: true, vertical: false)
			.overlay(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.stroke(AppTheme.separator, lineWidth: 1)
			)
		}
		.frame(maxWidth: .infinity)
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

private extension Array {
	subscript(safe index: Int) -> Element? {
		indices.contains(index) ? self[index] : nil
	}
}

private extension TextAlignment {
	var alignment: Alignment {
		switch self {
		case .leading: return .leading
		case .center: return .center
		case .trailing: return .trailing
		@unknown default: return .leading
		}
	}
}
