import { describe, expect, it } from "vitest";
import {
	isSafeLinkHref,
	parseBoldSegments,
	parseInlineMarkdownPieces,
	parseMarkdownHeading,
	splitBareUrls,
	splitMarkdownLinks,
} from "../src/ui/chat/markdown-inline";

describe("parseBoldSegments", () => {
	it("toggles on **", () => {
		expect(parseBoldSegments("a **b** c")).toEqual([
			{ bold: false, text: "a " },
			{ bold: true, text: "b" },
			{ bold: false, text: " c" },
		]);
	});

	it("supports __ delimiters", () => {
		expect(parseBoldSegments("__x__")).toEqual([{ bold: true, text: "x" }]);
	});
});

describe("parseInlineMarkdownPieces", () => {
	it("parses italic in plain spans", () => {
		expect(parseInlineMarkdownPieces("plain *italic* end")).toEqual([
			{ bold: false, italic: false, text: "plain " },
			{ bold: false, italic: true, text: "italic" },
			{ bold: false, italic: false, text: " end" },
		]);
	});

	it("does not italicize inside bold runs", () => {
		expect(parseInlineMarkdownPieces("**no *x* here**")).toEqual([
			{ bold: true, italic: false, text: "no *x* here" },
		]);
	});

	it("parses markdown links with styled labels", () => {
		expect(
			parseInlineMarkdownPieces("see [the **docs**](https://example.com) now"),
		).toEqual([
			{ bold: false, italic: false, text: "see " },
			{
				bold: false,
				italic: false,
				text: "the ",
				href: "https://example.com",
			},
			{
				bold: true,
				italic: false,
				text: "docs",
				href: "https://example.com",
			},
			{ bold: false, italic: false, text: " now" },
		]);
	});

	it("detects bare https URLs", () => {
		expect(parseInlineMarkdownPieces("visit https://example.com today")).toEqual([
			{ bold: false, italic: false, text: "visit " },
			{
				bold: false,
				italic: false,
				text: "https://example.com",
				href: "https://example.com",
			},
			{ bold: false, italic: false, text: " today" },
		]);
	});

	it("leaves unsafe link targets as literal markdown", () => {
		expect(parseInlineMarkdownPieces("[x](javascript:alert(1))")).toEqual([
			{ bold: false, italic: false, text: "[x](javascript:alert(1))" },
		]);
	});
});

describe("splitMarkdownLinks", () => {
	it("extracts safe markdown links", () => {
		expect(splitMarkdownLinks("a [b](https://x.test) c")).toEqual([
			{ text: "a " },
			{ text: "b", href: "https://x.test" },
			{ text: " c" },
		]);
	});
});

describe("splitBareUrls", () => {
	it("splits http URLs from surrounding text", () => {
		expect(splitBareUrls("go to http://a.test ok")).toEqual([
			{ text: "go to " },
			{ text: "http://a.test", href: "http://a.test" },
			{ text: " ok" },
		]);
	});
});

describe("isSafeLinkHref", () => {
	it("accepts http, https, and mailto", () => {
		expect(isSafeLinkHref("https://example.com")).toBe(true);
		expect(isSafeLinkHref("http://example.com")).toBe(true);
		expect(isSafeLinkHref("mailto:hi@example.com")).toBe(true);
	});

	it("rejects javascript URLs", () => {
		expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
	});
});

describe("parseMarkdownHeading", () => {
	it("parses h1 headings", () => {
		expect(parseMarkdownHeading("# Title")).toEqual({
			level: 1,
			text: "Title",
		});
	});

	it("parses heading levels through h6", () => {
		expect(parseMarkdownHeading("###### Tiny")).toEqual({
			level: 6,
			text: "Tiny",
		});
	});

	it("returns null when line is not a heading", () => {
		expect(parseMarkdownHeading("plain text")).toBeNull();
		expect(parseMarkdownHeading("##Title")).toBeNull();
	});
});
