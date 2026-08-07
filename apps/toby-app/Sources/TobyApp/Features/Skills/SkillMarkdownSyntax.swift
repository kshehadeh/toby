import AppKit

/// Applies dark-mode markdown syntax highlighting to an editor's text storage.
@MainActor
enum SkillMarkdownSyntax {
	static let fontSize: CGFloat = 12.5
	static let baseFont = NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
	static let semiboldFont = NSFont.monospacedSystemFont(ofSize: fontSize, weight: .semibold)

	static let primaryColor = NSColor.tobyMarkdownPrimary
	static let markerColor = NSColor.tobyMarkdownMarker
	static let headingColor = NSColor.tobyMarkdownHeading
	static let codeColor = NSColor.tobyMarkdownCode
	static let codeBackground = NSColor.tobyMarkdownCodeBackground
	static let boldColor = NSColor.tobyMarkdownBold

	static let paragraphStyle: NSParagraphStyle = {
		let style = NSMutableParagraphStyle()
		// Use lineSpacing (space *between* fragments), not lineHeightMultiple.
		// The latter expands the line fragment itself, so AppKit draws a caret
		// that is taller than the glyphs. Leave insertion-point drawing to NSTextView.
		let natural = baseFont.ascender - baseFont.descender
		style.lineSpacing = ceil(natural * 0.75)
		return style
	}()

	static var baseTypingAttributes: [NSAttributedString.Key: Any] {
		[
			.font: baseFont,
			.foregroundColor: primaryColor,
			.paragraphStyle: paragraphStyle,
		]
	}

	private static let headingRegex = try? NSRegularExpression(
		pattern: "^(#{1,6})(\\s+)(.*)$",
	)
	private static let listRegex = try? NSRegularExpression(
		pattern: "^(\\s*)([-*+])(\\s+)",
	)
	private static let quoteRegex = try? NSRegularExpression(
		pattern: "^(\\s*>+)(\\s?)",
	)
	private static let boldRegex = try? NSRegularExpression(
		pattern: "\\*\\*([^*]+)\\*\\*",
	)
	private static let inlineCodeRegex = try? NSRegularExpression(
		pattern: "`([^`]+)`",
	)

	static func apply(to storage: NSTextStorage) {
		let text = storage.string
		let full = NSRange(location: 0, length: (text as NSString).length)

		storage.beginEditing()
		storage.setAttributes(
			baseTypingAttributes,
			range: full,
		)

		let ns = text as NSString
		var inFence = false
		ns.enumerateSubstrings(in: full, options: [.byLines, .substringNotRequired]) {
			_, lineRange, _, _ in
			let line = ns.substring(with: lineRange)
			let trimmed = line.trimmingCharacters(in: .whitespaces)

			if trimmed.hasPrefix("```") {
				storage.addAttribute(.foregroundColor, value: markerColor, range: lineRange)
				storage.addAttribute(.backgroundColor, value: codeBackground, range: lineRange)
				inFence.toggle()
				return
			}

			if inFence {
				storage.addAttribute(.foregroundColor, value: codeColor, range: lineRange)
				storage.addAttribute(.backgroundColor, value: codeBackground, range: lineRange)
				return
			}

			applyHeading(storage, line: line, lineRange: lineRange)
			applyLineMarker(listRegex, storage, line: line, lineRange: lineRange)
			applyLineMarker(quoteRegex, storage, line: line, lineRange: lineRange)
			applyInline(boldRegex, storage, line: line, lineRange: lineRange, color: boldColor, font: semiboldFont)
			applyInline(inlineCodeRegex, storage, line: line, lineRange: lineRange, color: codeColor, font: baseFont)
		}

		storage.endEditing()
	}

	private static func applyHeading(
		_ storage: NSTextStorage,
		line: String,
		lineRange: NSRange,
	) {
		guard let headingRegex else { return }
		let lineNS = line as NSString
		let local = NSRange(location: 0, length: lineNS.length)
		guard let match = headingRegex.firstMatch(in: line, range: local) else { return }
		let hashes = offsetRange(match.range(at: 1), by: lineRange.location)
		let space = offsetRange(match.range(at: 2), by: lineRange.location)
		let content = offsetRange(match.range(at: 3), by: lineRange.location)
		storage.addAttribute(.foregroundColor, value: markerColor, range: hashes)
		storage.addAttribute(.foregroundColor, value: markerColor, range: space)
		storage.addAttributes(
			[.foregroundColor: headingColor, .font: semiboldFont],
			range: content,
		)
	}

	private static func applyLineMarker(
		_ regex: NSRegularExpression?,
		_ storage: NSTextStorage,
		line: String,
		lineRange: NSRange,
	) {
		guard let regex else { return }
		let lineNS = line as NSString
		let local = NSRange(location: 0, length: lineNS.length)
		guard let match = regex.firstMatch(in: line, range: local) else { return }
		let markerRange = offsetRange(match.range, by: lineRange.location)
		storage.addAttribute(.foregroundColor, value: markerColor, range: markerRange)
	}

	private static func applyInline(
		_ regex: NSRegularExpression?,
		_ storage: NSTextStorage,
		line: String,
		lineRange: NSRange,
		color: NSColor,
		font: NSFont,
	) {
		guard let regex else { return }
		let lineNS = line as NSString
		let local = NSRange(location: 0, length: lineNS.length)
		for match in regex.matches(in: line, range: local) where match.numberOfRanges >= 2 {
			let inner = offsetRange(match.range(at: 1), by: lineRange.location)
			storage.addAttributes([.foregroundColor: color, .font: font], range: inner)
		}
	}

	private static func offsetRange(_ range: NSRange, by offset: Int) -> NSRange {
		guard range.location != NSNotFound else { return range }
		return NSRange(location: range.location + offset, length: range.length)
	}
}
