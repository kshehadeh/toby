import Testing
@testable import TobyApp

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
}
