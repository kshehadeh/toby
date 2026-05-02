import { describe, expect, it } from "vitest";
import {
	parseBoldSegments,
	parseInlineMarkdownPieces,
	parseMarkdownHeading,
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
