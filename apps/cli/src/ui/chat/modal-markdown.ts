import {
	type InlinePiece,
	parseInlineMarkdownPieces,
	parseMarkdownHeading,
} from "./markdown-inline";

export type ModalInlinePiece = InlinePiece & {
	readonly color?: string;
};

export type StatusGlyphPrefix = {
	readonly indent: string;
	readonly glyph: string;
	readonly glyphColor: string;
	readonly body: string;
};

const STATUS_WORD_COLORS: Record<string, string> = {
	connected: "green",
	disconnected: "red",
	disabled: "yellow",
	invalid: "red",
};

const STATUS_GLYPH_PREFIXES: readonly {
	readonly prefix: string;
	readonly glyph: string;
	readonly glyphColor: string;
}[] = [
	{ prefix: "✔︎ ", glyph: "✔︎", glyphColor: "green" },
	{ prefix: "✔ ", glyph: "✔", glyphColor: "green" },
	{ prefix: "✗ ", glyph: "✗", glyphColor: "red" },
	{ prefix: "– ", glyph: "–", glyphColor: "yellow" },
];

export function splitStatusGlyphPrefix(line: string): StatusGlyphPrefix | null {
	const trimmed = line.trimStart();
	const indent = line.slice(0, line.length - trimmed.length);
	for (const entry of STATUS_GLYPH_PREFIXES) {
		if (!trimmed.startsWith(entry.prefix)) {
			continue;
		}
		return {
			indent,
			glyph: entry.glyph,
			glyphColor: entry.glyphColor,
			body: trimmed.slice(entry.prefix.length),
		};
	}
	return null;
}

function splitStatusWordPieces(text: string): ModalInlinePiece[] {
	if (!text) {
		return [];
	}
	const re = /\b(connected|disconnected|disabled|invalid)\b/g;
	const out: ModalInlinePiece[] = [];
	let last = 0;
	for (const match of text.matchAll(re)) {
		const idx = match.index ?? 0;
		if (idx > last) {
			out.push({
				bold: false,
				italic: false,
				text: text.slice(last, idx),
			});
		}
		const word = match[1] ?? "";
		out.push({
			bold: false,
			italic: false,
			text: word,
			color: STATUS_WORD_COLORS[word],
		});
		last = idx + word.length;
	}
	if (last < text.length) {
		out.push({
			bold: false,
			italic: false,
			text: text.slice(last),
		});
	}
	return out.length > 0 ? out : [{ bold: false, italic: false, text }];
}

export function parseModalInlinePieces(line: string): ModalInlinePiece[] {
	const heading = parseMarkdownHeading(line);
	const lineText = heading ? heading.text : line;
	const raw = parseInlineMarkdownPieces(lineText);
	const out: ModalInlinePiece[] = [];

	for (const piece of raw) {
		if (piece.href || piece.bold || piece.italic) {
			out.push(piece);
			continue;
		}
		out.push(...splitStatusWordPieces(piece.text));
	}

	return out.length > 0 ? out : [{ bold: false, italic: false, text: " " }];
}

export function isDimModalHintLine(line: string): boolean {
	const trimmed = line.trimStart();
	return trimmed.startsWith("Run ") || trimmed.startsWith("Install ");
}
