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
}
