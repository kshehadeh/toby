import { describe, expect, it } from "vitest";
import {
	formatMarkdownTable,
	isMarkdownTableRow,
	isMarkdownTableSeparator,
	layoutMarkdownTableColumns,
	parseMarkdownTable,
	segmentMarkdownLines,
	splitMarkdownTableCells,
	splitTextAndTables,
} from "../src/ui/chat/markdown-table";

describe("markdown table parsing", () => {
	const tableLines = [
		"| Name | Score |",
		"| ---- | ----- |",
		"| Ada  | 98    |",
		"| Bob  | 87    |",
	];

	it("detects table rows and separators", () => {
		expect(isMarkdownTableRow("| a | b |")).toBe(true);
		expect(isMarkdownTableRow("plain text")).toBe(false);
		expect(isMarkdownTableSeparator("| --- | :---: |")).toBe(true);
		expect(isMarkdownTableSeparator("| not | table |")).toBe(false);
	});

	it("splits cells", () => {
		expect(splitMarkdownTableCells("| a | b |")).toEqual(["a", "b"]);
	});

	it("parses a GFM table", () => {
		expect(parseMarkdownTable(tableLines)).toEqual([
			["Name", "Score"],
			["Ada", "98"],
			["Bob", "87"],
		]);
	});

	it("splits text around tables without wrapping table lines", () => {
		const blocks = splitTextAndTables(
			"Intro line\n| H1 | H2 |\n| -- | -- |\n| a | b |\nOutro",
		);
		expect(blocks).toEqual([
			{ kind: "text", text: "Intro line" },
			{ kind: "table", lines: ["| H1 | H2 |", "| -- | -- |", "| a | b |"] },
			{ kind: "text", text: "Outro" },
		]);
	});

	it("segments flat lines into table and line runs", () => {
		const segments = segmentMarkdownLines(["hello", ...tableLines, "bye"]);
		expect(segments).toEqual([
			{ kind: "line", line: "hello", lineCount: 1 },
			{
				kind: "table",
				rows: [
					["Name", "Score"],
					["Ada", "98"],
					["Bob", "87"],
				],
				lineCount: 4,
			},
			{ kind: "line", line: "bye", lineCount: 1 },
		]);
	});
});

describe("markdown table layout", () => {
	it("shrinks columns to fit max width", () => {
		const rows = [
			["Name", "Description"],
			["x", "y"],
		];
		const widths = layoutMarkdownTableColumns(rows, 24);
		expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(24);
	});

	it("renders box-drawing borders", () => {
		const formatted = formatMarkdownTable(
			[
				["A", "B"],
				["1", "2"],
			],
			80,
		);
		expect(formatted[0]?.line.startsWith("\u250c")).toBe(true);
		expect(formatted[1]?.line.startsWith("\u2502")).toBe(true);
		expect(formatted.at(-1)?.line.endsWith("\u2518")).toBe(true);
	});
});
