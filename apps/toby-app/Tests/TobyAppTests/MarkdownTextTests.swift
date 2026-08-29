import SwiftUI
import Testing
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("MarkdownText")
struct MarkdownTextTests {
	@Test("renders blockquote lines without the markdown marker")
	func rendersBlockquote() {
		let blocks = MarkdownText.parseBlocks(
			"Before\n\n> Quoted line\n> With **emphasis**\n\nAfter"
		)

		#expect(blocks == [
			.paragraph("Before"),
			.blockquote("Quoted line\nWith **emphasis**"),
			.paragraph("After"),
		])
	}

	@Test("renders horizontal rule")
	func rendersHorizontalRule() {
		let blocks = MarkdownText.parseBlocks("Before\n\n----\n\nAfter")

		#expect(blocks == [
			.paragraph("Before"),
			.horizontalRule,
			.paragraph("After"),
		])
	}

	@Test("parses h1 h2 h3 headings")
	func parsesHeadings() {
		let blocks = MarkdownText.parseBlocks("# Important\n\n## Other\n\n### Nested\n\nBody")

		#expect(blocks == [
			.heading(level: 1, content: "Important"),
			.heading(level: 2, content: "Other"),
			.heading(level: 3, content: "Nested"),
			.paragraph("Body"),
		])
	}

	@Test("parses ordered steps")
	func parsesOrderedSteps() {
		let blocks = MarkdownText.parseBlocks(
			"WHAT I'D DO NEXT\n\n1. Update the payment method\n2. Replace the battery"
		)

		#expect(blocks == [
			.paragraph("WHAT I'D DO NEXT"),
			.orderedStep(number: 1, content: "Update the payment method"),
			.orderedStep(number: 2, content: "Replace the battery"),
		])
	}

	@Test("parses a standalone markdown image")
	func parsesStandaloneImage() throws {
		let blocks = MarkdownText.parseBlocks(
			"![Trex Enhance Naturals Honey Grove 16 ft.](https://cdn.example.com/enhance.jpg)"
		)
		let image = try #require(firstImage(in: blocks))
		#expect(image.alt == "Trex Enhance Naturals Honey Grove 16 ft.")
		#expect(image.source.absoluteString == "https://cdn.example.com/enhance.jpg")
		#expect(image.linkURL == nil)
	}

	@Test("groups consecutive product images into one row")
	func groupsConsecutiveImages() throws {
		let blocks = MarkdownText.parseBlocks(
			"""
			![Enhance](https://cdn.example.com/enhance.jpg)

			![Select](https://cdn.example.com/select.jpg)
			"""
		)
		#expect(blocks.count == 1)
		guard case .imageGroup(let images) = blocks[0] else {
			Issue.record("Expected a single image group")
			return
		}
		#expect(images.map(\.alt) == ["Enhance", "Select"])
	}

	@Test("parses a linked markdown image")
	func parsesLinkedImage() throws {
		let blocks = MarkdownText.parseBlocks(
			"[![Honey Grove](https://cdn.example.com/enhance.jpg)](https://retailer.example.com/p/123)"
		)
		let image = try #require(firstImage(in: blocks))
		#expect(image.alt == "Honey Grove")
		#expect(image.source.absoluteString == "https://cdn.example.com/enhance.jpg")
		#expect(image.linkURL?.absoluteString == "https://retailer.example.com/p/123")
		#expect(image.openURL.absoluteString == "https://retailer.example.com/p/123")
	}

	@Test("parses an HTML image tag")
	func parsesHTMLImage() throws {
		let blocks = MarkdownText.parseBlocks(
			#"<img src="https://cdn.example.com/board.png" alt="Malted Barley">"#
		)
		let image = try #require(firstImage(in: blocks))
		#expect(image.alt == "Malted Barley")
		#expect(image.source.absoluteString == "https://cdn.example.com/board.png")
	}

	@Test("parses a bare image URL on its own line")
	func parsesBareImageURL() throws {
		let blocks = MarkdownText.parseBlocks("https://cdn.example.com/photo.webp?w=800")
		let image = try #require(firstImage(in: blocks))
		#expect(image.source.absoluteString == "https://cdn.example.com/photo.webp?w=800")
		#expect(image.alt.isEmpty)
	}

	@Test("keeps surrounding text when an image sits inline")
	func splitsMixedParagraph() throws {
		let blocks = MarkdownText.parseBlocks(
			"See ![deck](https://cdn.example.com/deck.jpg) for the color."
		)
		#expect(blocks == [
			.paragraph("See"),
			.imageGroup([
				MarkdownImage(
					alt: "deck",
					source: URL(string: "https://cdn.example.com/deck.jpg")!,
					linkURL: nil
				),
			]),
			.paragraph("for the color."),
		])
	}

	@Test("extracts images from bullet lists")
	func parsesBulletImages() throws {
		let blocks = MarkdownText.parseBlocks("- ![Enhance](https://cdn.example.com/a.jpg)")
		let image = try #require(firstImage(in: blocks))
		#expect(image.alt == "Enhance")
	}

	@Test("does not treat javascript or file URLs as images")
	func rejectsUnsafeImageURLs() {
		#expect(MarkdownText.parseBlocks("![x](javascript:alert(1))") == [
			.paragraph("![x](javascript:alert(1))"),
		])
		#expect(MarkdownText.parseBlocks("![x](file:///tmp/secret.png)") == [
			.paragraph("![x](file:///tmp/secret.png)"),
		])
	}

	@Test("leaves fenced image markdown as code")
	func ignoresImagesInsideCodeFences() {
		let blocks = MarkdownText.parseBlocks("```\n![nope](https://cdn.example.com/a.jpg)\n```")
		#expect(blocks == [.code("![nope](https://cdn.example.com/a.jpg)")])
	}

	@Test("identifies a table cell that is only an image")
	func singleImageFromTableCell() throws {
		let image = try #require(
			MarkdownParser.singleImage(from: "![Honey Grove](https://cdn.example.com/a.jpg)")
		)
		#expect(image.alt == "Honey Grove")
		#expect(MarkdownParser.singleImage(from: "![x](https://cdn.example.com/a.jpg) extra") == nil)
	}

	@Test("renders an image group in the transcript")
	func rendersImageGroup() throws {
		let view = MarkdownText(
			text: "![Honey Grove](https://cdn.example.com/enhance.jpg)",
			font: .body,
			foregroundStyle: .primary,
			usesProseTypography: true,
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "markdown-image-group")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "markdown-remote-image")
		}
	}

	@Test("parses a file:// markdown download link")
	func parsesFileURLDownloadLink() throws {
		let blocks = MarkdownText.parseBlocks(
			"[Download vim-cheat-sheet.md](file:///Users/example/.toby/generated-files/vim-cheat-sheet.md)"
		)
		let file = try #require(firstFileLink(in: blocks))
		#expect(file.label == "Download vim-cheat-sheet.md")
		#expect(file.filename == "vim-cheat-sheet.md")
		#expect(file.destination.hasPrefix("file://"))
	}

	@Test("parses an absolute path download link")
	func parsesAbsolutePathDownloadLink() throws {
		let blocks = MarkdownText.parseBlocks(
			"Generated the sheet:\n[Download notes.md](/Users/example/.toby/generated-files/notes.md)"
		)
		#expect(blocks.count == 2)
		guard case .paragraph(let text) = blocks[0] else {
			Issue.record("Expected surrounding text")
			return
		}
		#expect(text == "Generated the sheet:")
		let file = try #require(firstFileLink(in: blocks))
		#expect(file.filename == "notes.md")
	}

	@Test("parses a relative generated-file download link")
	func parsesRelativeDownloadLink() throws {
		let blocks = MarkdownText.parseBlocks("[Download vim-cheat-sheet.md](vim-cheat-sheet.md)")
		let file = try #require(firstFileLink(in: blocks))
		#expect(file.filename == "vim-cheat-sheet.md")
		let resolved = file.resolvedFileURL(generatedFilesDir: "/tmp/generated-files")
		#expect(resolved?.path == "/tmp/generated-files/vim-cheat-sheet.md")
	}

	@Test("leaves https links as paragraph markdown")
	func leavesHTTPSLinksInline() {
		#expect(MarkdownText.parseBlocks("[Apple](https://apple.com)") == [
			.paragraph("[Apple](https://apple.com)"),
		])
		#expect(MarkdownText.parseBlocks("[site](apple.com)") == [
			.paragraph("[site](apple.com)"),
		])
	}

	@Test("does not treat javascript links as files")
	func rejectsUnsafeFileDestinations() {
		#expect(MarkdownText.parseBlocks("[x](javascript:alert(1))") == [
			.paragraph("[x](javascript:alert(1))"),
		])
	}

	@Test("renders a generated file chip")
	func rendersFileLinkChip() throws {
		let view = MarkdownText(
			text: "[Download vim-cheat-sheet.md](file:///tmp/vim-cheat-sheet.md)",
			font: .body,
			foregroundStyle: .primary,
			usesProseTypography: true,
		)
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "markdown-file-link")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "markdown-file-link-download")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(viewWithAccessibilityIdentifier: "markdown-file-link-open")
		}
	}

	@Test("resolves file URLs and unique download names")
	func resolvesFileLinkHelpers() {
		let fileURL = MarkdownFileLink.resolvedFileURL(
			destination: "file:///Users/example/.toby/generated-files/notes.md",
			generatedFilesDir: "/tmp/generated-files"
		)
		#expect(fileURL?.path == "/Users/example/.toby/generated-files/notes.md")

		let relative = MarkdownFileLink.resolvedFileURL(
			destination: "reports/summary.md",
			generatedFilesDir: "/tmp/generated-files"
		)
		#expect(relative?.path == "/tmp/generated-files/reports/summary.md")

		#expect(MarkdownFileLink.isFileDestination("vim-cheat-sheet.md"))
		#expect(!MarkdownFileLink.isFileDestination("https://example.com/notes.md"))
		#expect(!MarkdownFileLink.isFileDestination("../escape.md"))

		let dir = URL(fileURLWithPath: "/tmp/downloads", isDirectory: true)
		let existing: Set<String> = [
			"/tmp/downloads/notes.md",
			"/tmp/downloads/notes (1).md",
		]
		let unique = MarkdownFileLink.uniqueURL(
			in: dir,
			preferredFilename: "notes.md",
			fileExists: { existing.contains($0) }
		)
		#expect(unique.lastPathComponent == "notes (2).md")
	}

	private func firstImage(in blocks: [MarkdownBlock]) -> MarkdownImage? {
		for block in blocks {
			if case .imageGroup(let images) = block, let image = images.first {
				return image
			}
		}
		return nil
	}

	private func firstFileLink(in blocks: [MarkdownBlock]) -> MarkdownFileLink? {
		for block in blocks {
			if case .fileLink(let file) = block {
				return file
			}
		}
		return nil
	}
}
