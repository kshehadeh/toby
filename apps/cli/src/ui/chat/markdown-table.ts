/** GFM pipe-table row (at least two cells). */
export function isMarkdownTableRow(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed.includes("|")) {
		return false;
	}
	return splitMarkdownTableCells(trimmed).length >= 2;
}

/** Alignment separator row (e.g. | --- | :---: | ---: |). */
export function isMarkdownTableSeparator(line: string): boolean {
	const cells = splitMarkdownTableCells(line.trim());
	if (cells.length === 0) {
		return false;
	}
	return cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

/** Split a pipe row into trimmed cell strings. */
export function splitMarkdownTableCells(line: string): string[] {
	let s = line.trim();
	if (s.startsWith("|")) {
		s = s.slice(1);
	}
	if (s.endsWith("|")) {
		s = s.slice(0, -1);
	}
	return s.split("|").map((c) => c.trim());
}

/** Parse a GFM table block (header, separator, body). Returns null if invalid. */
export function parseMarkdownTable(
	lines: readonly string[],
): string[][] | null {
	if (lines.length < 2) {
		return null;
	}
	if (!isMarkdownTableSeparator(lines[1] ?? "")) {
		return null;
	}
	if (
		!lines.every(
			(line) => isMarkdownTableRow(line) || isMarkdownTableSeparator(line),
		)
	) {
		return null;
	}
	const rows: string[][] = [];
	for (let i = 0; i < lines.length; i++) {
		if (i === 1) {
			continue;
		}
		rows.push(splitMarkdownTableCells(lines[i] ?? ""));
	}
	return rows.length > 0 ? rows : null;
}

export type TextOrTableBlock =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "table"; readonly lines: readonly string[] };

/**
 * Split assistant text into normal paragraphs and contiguous GFM table blocks.
 * Invalid table candidates fall back to plain text.
 */
export function splitTextAndTables(text: string): TextOrTableBlock[] {
	const result: TextOrTableBlock[] = [];
	let tableAcc: string[] = [];
	let textAcc: string[] = [];

	const flushText = () => {
		if (textAcc.length > 0) {
			result.push({ kind: "text", text: textAcc.join("\n") });
			textAcc = [];
		}
	};

	const flushTable = () => {
		if (tableAcc.length >= 2 && isMarkdownTableSeparator(tableAcc[1] ?? "")) {
			result.push({ kind: "table", lines: tableAcc });
		} else if (tableAcc.length > 0) {
			textAcc.push(...tableAcc);
		}
		tableAcc = [];
	};

	for (const line of text.split(/\r?\n/)) {
		if (isMarkdownTableRow(line)) {
			flushText();
			tableAcc.push(line);
			continue;
		}
		if (tableAcc.length > 0 && isMarkdownTableSeparator(line)) {
			tableAcc.push(line);
			continue;
		}
		flushTable();
		textAcc.push(line);
	}
	flushTable();
	flushText();
	return result;
}

export type MarkdownLineSegment =
	| { readonly kind: "line"; readonly line: string; readonly lineCount: 1 }
	| {
			readonly kind: "table";
			readonly rows: readonly string[][];
			readonly lineCount: number;
	  };

/** Group consecutive table lines in a flat line list for rendering. */
export function segmentMarkdownLines(
	lines: readonly string[],
): MarkdownLineSegment[] {
	const out: MarkdownLineSegment[] = [];
	let i = 0;
	while (i < lines.length) {
		const run = takeContiguousTableLines(lines, i);
		if (run) {
			const parsed = parseMarkdownTable(run.lines);
			if (parsed) {
				out.push({
					kind: "table",
					rows: parsed,
					lineCount: run.lines.length,
				});
			} else {
				for (const line of run.lines) {
					out.push({ kind: "line", line, lineCount: 1 });
				}
			}
			i = run.end;
			continue;
		}
		out.push({ kind: "line", line: lines[i] ?? "", lineCount: 1 });
		i += 1;
	}
	return out;
}

function takeContiguousTableLines(
	lines: readonly string[],
	start: number,
): { readonly lines: readonly string[]; readonly end: number } | null {
	if (!isMarkdownTableRow(lines[start] ?? "")) {
		return null;
	}
	let end = start + 1;
	while (end < lines.length) {
		const line = lines[end] ?? "";
		if (isMarkdownTableRow(line) || isMarkdownTableSeparator(line)) {
			end += 1;
			continue;
		}
		break;
	}
	return { lines: lines.slice(start, end), end };
}

const CELL_PAD = 1;
const MIN_COL_WIDTH = 3;

const BOX = {
	topLeft: "\u250c",
	topRight: "\u2510",
	bottomLeft: "\u2514",
	bottomRight: "\u2518",
	hLine: "\u2500",
	vLine: "\u2502",
	cross: "\u253c",
	topT: "\u252c",
	bottomT: "\u2534",
	leftT: "\u251c",
	rightT: "\u2524",
} as const;

function truncateCell(text: string, width: number): string {
	if (width < 1) {
		return "";
	}
	if (text.length <= width) {
		return text;
	}
	if (width === 1) {
		return ".";
	}
	return `${text.slice(0, width - 1)}...`;
}

function padCell(text: string, width: number): string {
	const clipped = truncateCell(text, width);
	return clipped.padEnd(width, " ");
}

/** Column widths for terminal layout, capped to maxWidth when possible. */
export function layoutMarkdownTableColumns(
	rows: readonly (readonly string[])[],
	maxWidth: number,
): number[] {
	const colCount = Math.max(0, ...rows.map((r) => r.length));
	const widths = Array.from({ length: colCount }, () => MIN_COL_WIDTH);
	for (const row of rows) {
		for (let c = 0; c < colCount; c++) {
			widths[c] = Math.max(widths[c] ?? MIN_COL_WIDTH, (row[c] ?? "").length);
		}
	}

	const borderChars = colCount + 1;
	const contentWidth =
		widths.reduce((sum, w) => sum + w + CELL_PAD * 2, 0) + borderChars;
	if (contentWidth <= maxWidth || colCount === 0) {
		return widths;
	}

	let overflow = contentWidth - maxWidth;
	const shrinkable = () =>
		widths
			.map((w, idx) => ({ w, idx }))
			.filter(({ w }) => w > MIN_COL_WIDTH)
			.sort((a, b) => b.w - a.w);

	while (overflow > 0 && shrinkable().length > 0) {
		const candidates = shrinkable();
		const target = candidates[0];
		if (!target) {
			break;
		}
		widths[target.idx] = (widths[target.idx] ?? MIN_COL_WIDTH) - 1;
		overflow -= 1;
	}
	return widths;
}

export type FormattedTableRow = {
	readonly line: string;
	readonly border: "top" | "header" | "mid" | "bottom" | "body";
};

/** Pre-rendered border + cell strings for each visual row. */
export function formatMarkdownTable(
	rows: readonly (readonly string[])[],
	maxWidth: number,
): FormattedTableRow[] {
	if (rows.length === 0) {
		return [];
	}
	const colWidths = layoutMarkdownTableColumns(rows, maxWidth);

	const hSegment = (w: number) => BOX.hLine.repeat(w + CELL_PAD * 2);
	const joinH = (parts: string[], junction: string) => parts.join(junction);

	const topBorder = () =>
		BOX.topLeft + joinH(colWidths.map(hSegment), BOX.topT) + BOX.topRight;
	const midBorder = () =>
		BOX.leftT + joinH(colWidths.map(hSegment), BOX.cross) + BOX.rightT;
	const bottomBorder = () =>
		BOX.bottomLeft +
		joinH(colWidths.map(hSegment), BOX.bottomT) +
		BOX.bottomRight;

	const dataRow = (cells: readonly string[]) => {
		const parts = colWidths.map((w, i) => ` ${padCell(cells[i] ?? "", w)} `);
		return BOX.vLine + parts.join(BOX.vLine) + BOX.vLine;
	};

	const out: FormattedTableRow[] = [{ line: topBorder(), border: "top" }];
	out.push({
		line: dataRow(rows[0] ?? []),
		border: "header",
	});
	if (rows.length > 1) {
		out.push({ line: midBorder(), border: "mid" });
		for (let i = 1; i < rows.length; i++) {
			out.push({
				line: dataRow(rows[i] ?? []),
				border: "body",
			});
		}
	}
	out.push({ line: bottomBorder(), border: "bottom" });
	return out;
}
