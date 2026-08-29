import Foundation
import SwiftUI

enum MarkdownParser {
	static func parseBlocks(_ text: String) -> [MarkdownBlock] {
		var output: [MarkdownBlock] = []
		var paragraph: [String] = []
		var code: [String] = []
		var tableRows: [String] = []
		var blockquote: [String] = []
		var inFence = false

		func flushParagraph() {
			guard !paragraph.isEmpty else { return }
			output.append(contentsOf: blocksFromFragments(
				paragraph.joined(separator: "\n"),
				wrapText: { .paragraph($0) },
			))
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
			output.append(contentsOf: blocksFromFragments(
				blockquote.joined(separator: "\n"),
				wrapText: { .blockquote($0) },
			))
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
			if let image = parseBareImageURL(line) {
				flushParagraph()
				output.append(.imageGroup([image]))
				continue
			}
			if line.hasPrefix("- ") {
				flushParagraph()
				output.append(contentsOf: blocksFromFragments(
					String(line.dropFirst(2)),
					wrapText: { .bullet($0) },
				))
				continue
			}
			if let orderedStep = parseOrderedStep(line) {
				flushParagraph()
				output.append(contentsOf: blocksFromFragments(
					orderedStep.content,
					wrapText: { .orderedStep(number: orderedStep.number, content: $0) },
				))
				continue
			}
			paragraph.append(rawLine)
		}

		flushTable()
		flushParagraph()
		flushBlockquote()
		flushCode()
		let blocks = output.isEmpty ? [MarkdownBlock.paragraph(text)] : output
		return groupConsecutiveImages(blocks)
	}

	/// The cell is a single markdown/HTML image with no surrounding text.
	static func singleImage(from text: String) -> MarkdownImage? {
		let fragments = splitInlineMedia(text)
		let images = fragments.compactMap { fragment -> MarkdownImage? in
			if case .image(let image) = fragment { return image }
			return nil
		}
		let hasText = fragments.contains { fragment in
			if case .text(let value) = fragment {
				return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
			}
			return false
		}
		guard images.count == 1, !hasText else { return nil }
		return images[0]
	}

	static func httpOrHttpsURL(from raw: String) -> URL? {
		let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		guard let url = URL(string: trimmed),
			let scheme = url.scheme?.lowercased(),
			scheme == "https" || scheme == "http",
			url.host != nil
		else {
			return nil
		}
		return url
	}

	private enum InlineFragment {
		case text(String)
		case image(MarkdownImage)
		case file(MarkdownFileLink)
	}

	private static func blocksFromFragments(
		_ text: String,
		wrapText: (String) -> MarkdownBlock,
	) -> [MarkdownBlock] {
		let fragments = splitInlineMedia(text)
		let hasMedia = fragments.contains { fragment in
			switch fragment {
			case .image, .file: return true
			case .text: return false
			}
		}
		guard hasMedia else {
			return [wrapText(text)]
		}
		var blocks: [MarkdownBlock] = []
		for fragment in fragments {
			switch fragment {
			case .text(let raw):
				let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
				if !trimmed.isEmpty {
					blocks.append(wrapText(trimmed))
				}
			case .image(let image):
				blocks.append(.imageGroup([image]))
			case .file(let file):
				blocks.append(.fileLink(file))
			}
		}
		return blocks.isEmpty ? [wrapText(text)] : blocks
	}

	private static func groupConsecutiveImages(_ blocks: [MarkdownBlock]) -> [MarkdownBlock] {
		var output: [MarkdownBlock] = []
		var pending: [MarkdownImage] = []

		func flushImages() {
			guard !pending.isEmpty else { return }
			output.append(.imageGroup(pending))
			pending.removeAll()
		}

		for block in blocks {
			if case .imageGroup(let images) = block {
				pending.append(contentsOf: images)
			} else {
				flushImages()
				output.append(block)
			}
		}
		flushImages()
		return output
	}

	private static func splitInlineMedia(_ text: String) -> [InlineFragment] {
		var fragments: [InlineFragment] = []
		var cursor = text.startIndex
		while cursor < text.endIndex {
			if let match = nextMedia(in: text, from: cursor) {
				if match.range.lowerBound > cursor {
					fragments.append(.text(String(text[cursor..<match.range.lowerBound])))
				}
				switch match {
				case .image(let image, _):
					fragments.append(.image(image))
				case .file(let file, _):
					fragments.append(.file(file))
				}
				cursor = match.range.upperBound
			} else {
				fragments.append(.text(String(text[cursor...])))
				break
			}
		}
		return fragments
	}

	private struct ImageMatch {
		let image: MarkdownImage
		let range: Range<String.Index>
	}

	private enum MediaMatch {
		case image(MarkdownImage, range: Range<String.Index>)
		case file(MarkdownFileLink, range: Range<String.Index>)

		var range: Range<String.Index> {
			switch self {
			case .image(_, let range), .file(_, let range):
				return range
			}
		}
	}

	private static func nextMedia(in text: String, from start: String.Index) -> MediaMatch? {
		var index = start
		while index < text.endIndex {
			if text[index] == "[", let match = parseLinkedImage(in: text, at: index) {
				return .image(match.image, range: match.range)
			}
			if text[index] == "!", let match = parseMarkdownImage(in: text, at: index) {
				return .image(match.image, range: match.range)
			}
			if text[index] == "[", let match = parseFileLink(in: text, at: index) {
				return .file(match.file, range: match.range)
			}
			if text[index] == "<", let match = parseHTMLImage(in: text, at: index) {
				return .image(match.image, range: match.range)
			}
			index = text.index(after: index)
		}
		return nil
	}

	private struct FileMatch {
		let file: MarkdownFileLink
		let range: Range<String.Index>
	}

	private static func parseFileLink(in text: String, at open: String.Index) -> FileMatch? {
		guard text[open] == "[" else { return nil }
		let labelStart = text.index(after: open)
		guard labelStart < text.endIndex, text[labelStart] != "!" else { return nil }
		guard let labelClose = text[labelStart...].firstIndex(of: "]") else { return nil }
		let afterLabel = text.index(after: labelClose)
		guard afterLabel < text.endIndex, text[afterLabel] == "(" else { return nil }
		guard let dest = parseParenthesizedDestination(text, from: text.index(after: afterLabel)),
			MarkdownFileLink.isFileDestination(dest.url)
		else {
			return nil
		}
		let label = String(text[labelStart..<labelClose])
		return FileMatch(
			file: MarkdownFileLink(label: label, destination: dest.url),
			range: open..<dest.end,
		)
	}

	private static func parseLinkedImage(in text: String, at open: String.Index) -> ImageMatch? {
		guard text[open] == "[" else { return nil }
		let innerStart = text.index(after: open)
		guard innerStart < text.endIndex, text[innerStart] == "!" else { return nil }
		guard let inner = parseMarkdownImage(in: text, at: innerStart) else { return nil }
		guard inner.range.upperBound < text.endIndex, text[inner.range.upperBound] == "]" else {
			return nil
		}
		let afterInner = text.index(after: inner.range.upperBound)
		guard afterInner < text.endIndex, text[afterInner] == "(" else { return nil }
		guard let dest = parseParenthesizedDestination(text, from: text.index(after: afterInner)),
			let linkURL = httpOrHttpsURL(from: dest.url)
		else {
			return nil
		}
		let image = MarkdownImage(alt: inner.image.alt, source: inner.image.source, linkURL: linkURL)
		return ImageMatch(image: image, range: open..<dest.end)
	}

	private static func parseMarkdownImage(in text: String, at bang: String.Index) -> ImageMatch? {
		guard text[bang] == "!" else { return nil }
		let afterBang = text.index(after: bang)
		guard afterBang < text.endIndex, text[afterBang] == "[" else { return nil }
		let altStart = text.index(after: afterBang)
		guard let altClose = text[altStart...].firstIndex(of: "]") else { return nil }
		let alt = String(text[altStart..<altClose])
		let afterAlt = text.index(after: altClose)
		guard afterAlt < text.endIndex, text[afterAlt] == "(" else { return nil }
		guard let dest = parseParenthesizedDestination(text, from: text.index(after: afterAlt)),
			let url = httpOrHttpsURL(from: dest.url)
		else {
			return nil
		}
		let caption = alt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
			? (dest.title ?? "")
			: alt
		let image = MarkdownImage(alt: caption, source: url, linkURL: nil)
		return ImageMatch(image: image, range: bang..<dest.end)
	}

	private struct ParsedDestination {
		let url: String
		let title: String?
		let end: String.Index
	}

	private static func parseParenthesizedDestination(
		_ text: String,
		from start: String.Index,
	) -> ParsedDestination? {
		var index = start
		while index < text.endIndex, text[index].isWhitespace {
			index = text.index(after: index)
		}
		guard index < text.endIndex else { return nil }

		let url: String
		if text[index] == "<" {
			let urlStart = text.index(after: index)
			guard let close = text[urlStart...].firstIndex(of: ">") else { return nil }
			url = String(text[urlStart..<close])
			index = text.index(after: close)
		} else {
			let urlStart = index
			while index < text.endIndex, text[index] != ")", !text[index].isWhitespace {
				index = text.index(after: index)
			}
			url = String(text[urlStart..<index])
		}
		guard !url.isEmpty else { return nil }

		while index < text.endIndex, text[index].isWhitespace {
			index = text.index(after: index)
		}

		var title: String?
		if index < text.endIndex, text[index] == "\"" || text[index] == "'" {
			let quote = text[index]
			index = text.index(after: index)
			let titleStart = index
			guard let titleClose = text[titleStart...].firstIndex(of: quote) else { return nil }
			title = String(text[titleStart..<titleClose])
			index = text.index(after: titleClose)
			while index < text.endIndex, text[index].isWhitespace {
				index = text.index(after: index)
			}
		}

		guard index < text.endIndex, text[index] == ")" else { return nil }
		return ParsedDestination(
			url: url.trimmingCharacters(in: .whitespacesAndNewlines),
			title: title,
			end: text.index(after: index),
		)
	}

	private static func parseHTMLImage(in text: String, at lt: String.Index) -> ImageMatch? {
		guard hasCaseInsensitivePrefix(text, at: lt, prefix: "<img") else { return nil }
		if let afterName = text.index(lt, offsetBy: 4, limitedBy: text.endIndex),
			afterName < text.endIndex
		{
			let next = text[afterName]
			guard next.isWhitespace || next == "/" || next == ">" else { return nil }
		}
		guard let gt = text[lt...].firstIndex(of: ">") else { return nil }
		let tag = String(text[lt...gt])
		guard let src = htmlAttribute(tag, name: "src"),
			let url = httpOrHttpsURL(from: src)
		else {
			return nil
		}
		let alt = htmlAttribute(tag, name: "alt") ?? ""
		return ImageMatch(
			image: MarkdownImage(alt: alt, source: url, linkURL: nil),
			range: lt..<text.index(after: gt),
		)
	}

	private static func hasCaseInsensitivePrefix(_ text: String, at index: String.Index, prefix: String) -> Bool {
		var cursor = index
		for expected in prefix {
			guard cursor < text.endIndex else { return false }
			if text[cursor].lowercased() != expected.lowercased() {
				return false
			}
			cursor = text.index(after: cursor)
		}
		return true
	}

	private static func htmlAttribute(_ tag: String, name: String) -> String? {
		let pattern = #"(?i)\#(name)\s*=\s*(?:"([^"]*)"|'([^']*)')"#
		guard let regex = try? NSRegularExpression(pattern: pattern),
			let match = regex.firstMatch(in: tag, range: NSRange(tag.startIndex..., in: tag))
		else {
			return nil
		}
		if let range = Range(match.range(at: 1), in: tag) {
			return String(tag[range])
		}
		if let range = Range(match.range(at: 2), in: tag) {
			return String(tag[range])
		}
		return nil
	}

	private static func parseBareImageURL(_ line: String) -> MarkdownImage? {
		let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
		guard trimmed.wholeMatch(of: /(?i)^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|bmp)(?:\?\S*)?$/) != nil,
			let url = httpOrHttpsURL(from: trimmed)
		else {
			return nil
		}
		return MarkdownImage(alt: "", source: url, linkURL: nil)
	}

	private static func isTableLine(_ line: String) -> Bool {
		line.hasPrefix("|") && line.hasSuffix("|")
	}

	private static func isHorizontalRuleLine(_ line: String) -> Bool {
		let trimmed = line.trimmingCharacters(in: .whitespaces)
		return trimmed.count >= 3 && trimmed.allSatisfy { $0 == "-" }
	}

	private static func parseOrderedStep(_ line: String) -> (number: Int, content: String)? {
		guard let match = line.firstMatch(of: /^(\d+)\.\s+(.+)$/),
			let number = Int(match.1)
		else {
			return nil
		}
		return (number, String(match.2))
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
