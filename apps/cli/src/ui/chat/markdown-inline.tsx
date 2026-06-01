import { Text } from "ink";
import type { ReactElement } from "react";

export type InlinePiece = {
	readonly bold: boolean;
	readonly italic: boolean;
	readonly text: string;
};

export type MarkdownHeading = {
	readonly level: 1 | 2 | 3 | 4 | 5 | 6;
	readonly text: string;
};

const HEADING_STYLE: Record<MarkdownHeading["level"], { color: string }> = {
	1: { color: "blue" },
	2: { color: "cyan" },
	3: { color: "magenta" },
	4: { color: "green" },
	5: { color: "yellow" },
	6: { color: "gray" },
};

export function parseMarkdownHeading(line: string): MarkdownHeading | null {
	const m = line.match(/^\s{0,3}(#{1,6})(?:\s+|$)(.*)$/);
	if (!m) {
		return null;
	}
	const level = (m[1]?.length ?? 0) as MarkdownHeading["level"];
	if (level < 1 || level > 6) {
		return null;
	}
	return { level, text: m[2] ?? "" };
}

/** Split `line` by `**` / `__` toggling bold (common Markdown bold). */
export function parseBoldSegments(
	line: string,
): { bold: boolean; text: string }[] {
	const out: { bold: boolean; text: string }[] = [];
	let buf = "";
	let bold = false;
	let i = 0;

	const flush = () => {
		out.push({ bold, text: buf });
		buf = "";
	};

	while (i < line.length) {
		if (line[i] === "*" && line[i + 1] === "*") {
			flush();
			bold = !bold;
			i += 2;
			continue;
		}
		if (line[i] === "_" && line[i + 1] === "_") {
			flush();
			bold = !bold;
			i += 2;
			continue;
		}
		buf += line[i] ?? "";
		i += 1;
	}
	flush();
	return out.filter((s) => s.text.length > 0);
}

/**
 * Within non-bold spans, treat `*segment*` as italic (does not cross `**`, which is removed earlier).
 */
export function splitItalicInPlain(text: string): {
	bold: boolean;
	italic: boolean;
	text: string;
}[] {
	if (!text.includes("*")) {
		return [{ bold: false, italic: false, text }];
	}
	const parts: InlinePiece[] = [];
	let last = 0;
	const re = /\*([^*]+)\*/g;
	for (const m of text.matchAll(re)) {
		const idx = m.index ?? 0;
		if (idx > last) {
			parts.push({
				bold: false,
				italic: false,
				text: text.slice(last, idx),
			});
		}
		parts.push({
			bold: false,
			italic: true,
			text: m[1] ?? "",
		});
		last = idx + (m[0]?.length ?? 0);
	}
	if (last < text.length) {
		parts.push({
			bold: false,
			italic: false,
			text: text.slice(last),
		});
	}
	return parts.length > 0 ? parts : [{ bold: false, italic: false, text }];
}

export function parseInlineMarkdownPieces(line: string): InlinePiece[] {
	const boldParts = parseBoldSegments(line);
	const out: InlinePiece[] = [];
	for (const seg of boldParts) {
		if (seg.bold) {
			out.push({ bold: true, italic: false, text: seg.text });
			continue;
		}
		out.push(...splitItalicInPlain(seg.text));
	}
	return out.length > 0 ? out : [{ bold: false, italic: false, text: "" }];
}

/** One logical line: optional list marker (plain) + inline markdown body. */
export function AssistantMarkdownLine(props: {
	readonly marker?: string | null;
	readonly text: string;
	readonly dimColor?: boolean;
}): ReactElement {
	const heading = props.marker ? null : parseMarkdownHeading(props.text);
	const lineText = heading ? heading.text : props.text;
	const raw = parseInlineMarkdownPieces(lineText);
	const pieces = raw.some((p) => p.text.length > 0)
		? raw
		: [{ bold: false, italic: false, text: props.marker ? "" : " " }];
	const headingColor = heading ? HEADING_STYLE[heading.level].color : undefined;
	return (
		<Text wrap="truncate-end">
			{props.marker ? (
				<Text dimColor={props.dimColor}>{props.marker}</Text>
			) : null}
			{pieces.map((p, idx) => {
				const pieceKey = `${p.bold}-${p.italic}-${idx}-${p.text}`;
				return (
					<Text
						key={pieceKey}
						bold={heading ? true : p.bold}
						italic={p.italic}
						dimColor={props.dimColor}
						color={headingColor}
					>
						{p.text}
					</Text>
				);
			})}
		</Text>
	);
}

export function MarkdownInlineText(props: {
	readonly line: string;
	readonly dimColor?: boolean;
	readonly wrap?: "truncate-end" | "wrap";
}): ReactElement {
	const heading = parseMarkdownHeading(props.line);
	const lineText = heading ? heading.text : props.line;
	const raw = parseInlineMarkdownPieces(lineText);
	const pieces = raw.some((p) => p.text.length > 0)
		? raw
		: [{ bold: false, italic: false, text: " " }];
	const wrap = props.wrap ?? "truncate-end";
	const headingColor = heading ? HEADING_STYLE[heading.level].color : undefined;
	return (
		<Text dimColor={props.dimColor} wrap={wrap}>
			{pieces.map((p, idx) => {
				const pieceKey = `${p.bold}-${p.italic}-${idx}-${p.text}`;
				return (
					<Text
						key={pieceKey}
						bold={heading ? true : p.bold}
						italic={p.italic}
						dimColor={props.dimColor}
						color={headingColor}
					>
						{p.text}
					</Text>
				);
			})}
		</Text>
	);
}
