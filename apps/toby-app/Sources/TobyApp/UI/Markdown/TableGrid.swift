import SwiftUI

struct TableGrid: View {
	let table: MarkdownTable
	let font: Font
	let foregroundStyle: Color
	var strongForegroundStyle: Color? = nil

	var body: some View {
		ScrollView(.horizontal) {
			Grid(alignment: .top, horizontalSpacing: 0, verticalSpacing: 0) {
				ForEach(Array(table.cells.enumerated()), id: \.offset) { rowIndex, row in
					let isHeader = table.hasHeader && rowIndex == 0
					GridRow {
						ForEach(Array(row.enumerated()), id: \.offset) { colIndex, cell in
							let alignment = table.alignments[safe: colIndex] ?? .leading
							TableCell(
								text: cell,
								font: font,
								foregroundStyle: foregroundStyle,
								strongForegroundStyle: strongForegroundStyle,
								alignment: alignment,
								isHeader: isHeader
							)
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

struct TableCell: View {
	let text: String
	let font: Font
	let foregroundStyle: Color
	var strongForegroundStyle: Color? = nil
	let alignment: TextAlignment
	let isHeader: Bool

	var body: some View {
		ZStack(alignment: alignment.zstackAlignment) {
			Rectangle()
				.fill(isHeader ? AppTheme.elevatedBackground.opacity(0.5) : Color.clear)
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			cellText
				.font(isHeader ? AppTheme.transcriptTableHeaderFont : font)
				.monospacedDigit()
				.multilineTextAlignment(alignment)
				.padding(.horizontal, 12)
				.padding(.vertical, 8)
		}
	}

	@ViewBuilder
	private var cellText: some View {
		if let strong = strongForegroundStyle {
			InlineMarkdownText(
				text: text,
				baseForeground: foregroundStyle,
				strongForeground: strong
			)
		} else {
			InlineMarkdownText(text: text)
				.foregroundStyle(foregroundStyle)
		}
	}
}
