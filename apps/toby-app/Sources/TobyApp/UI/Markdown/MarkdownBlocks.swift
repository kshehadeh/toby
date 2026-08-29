import SwiftUI

struct MarkdownImage: Equatable {
	let alt: String
	let source: URL
	/// When the image is wrapped in a markdown link (`[![alt](src)](href)`), open this instead of `source`.
	let linkURL: URL?

	var openURL: URL {
		linkURL ?? source
	}

	var caption: String {
		alt.trimmingCharacters(in: .whitespacesAndNewlines)
	}
}

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
	case orderedStep(number: Int, content: String)
	case blockquote(String)
	case horizontalRule
	case code(String)
	case table(MarkdownTable)
	case imageGroup([MarkdownImage])
}
