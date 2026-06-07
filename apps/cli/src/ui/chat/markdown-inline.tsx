import { Text } from "ink";
import Link from "ink-link";
import type { ReactElement, ReactNode } from "react";

export type InlinePiece = {
	readonly bold: boolean;
	readonly italic: boolean;
	readonly text: string;
	readonly href?: string;
};

export type MarkdownHeading = {
	readonly level: 1 | 2 | 3 | 4 | 5 | 6;
	readonly text: string;
};

type LinkSegment = {
	readonly text: string;
	readonly href?: string;
};

type InlineRenderOptions = {
	readonly heading?: boolean;
	readonly headingColor?: string;
	readonly dimColor?: boolean;
	readonly pieceColor?: (piece: InlinePiece & { readonly color?: string }) =>
		| string
		| undefined;
};

const HEADING_STYLE: Record<MarkdownHeading["level"], { color: string }> = {
	1: { color: "blue" },
	2: { color: "cyan" },
	3: { color: "magenta" },
	4: { color: "green" },
	5: { color: "yellow" },
	6: { color: "gray" },
};

const BARE_URL_RE = /https?:\/\/[^\s<>)\]}"'`,]+/g;

const LINK_COLOR = "cyan";

type ParsedMarkdownLink = LinkSegment & { readonly consumed: number };

function splitMarkdownLinksAt(line: string, start: number): ParsedMarkdownLink | null {
	if (line[start] !== "[") {
		return null;
	}
	const labelEnd = line.indexOf("]", start + 1);
	if (labelEnd === -1 || line[labelEnd + 1] !== "(") {
		return null;
	}
	let depth = 0;
	let urlEnd = -1;
	for (let j = labelEnd + 2; j < line.length; j++) {
		const ch = line[j];
		if (ch === "(") {
			depth += 1;
		} else if (ch === ")") {
			if (depth === 0) {
				urlEnd = j;
				break;
			}
			depth -= 1;
		}
	}
	if (urlEnd === -1) {
		return null;
	}
	const label = line.slice(start + 1, labelEnd);
	const href = line.slice(labelEnd + 2, urlEnd).trim();
	const raw = line.slice(start, urlEnd + 1);
	if (isSafeLinkHref(href)) {
		return { text: label, href, consumed: urlEnd + 1 - start };
	}
	return { text: raw, consumed: urlEnd + 1 - start };
}

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

export function isSafeLinkHref(href: string): boolean {
	try {
		const url = new URL(href);
		return (
			url.protocol === "http:" ||
			url.protocol === "https:" ||
			url.protocol === "mailto:"
		);
	} catch {
		return false;
	}
}

/** Split `line` by GFM-style `[label](url)` links. Unsafe URLs stay literal. */
export function splitMarkdownLinks(line: string): LinkSegment[] {
	const out: LinkSegment[] = [];
	let i = 0;
	let buf = "";

	const flushBuf = () => {
		if (buf.length > 0) {
			out.push({ text: buf });
			buf = "";
		}
	};

	while (i < line.length) {
		const parsed = splitMarkdownLinksAt(line, i);
		if (parsed) {
			flushBuf();
			out.push({ text: parsed.text, href: parsed.href });
			i += parsed.consumed;
			continue;
		}
		buf += line[i] ?? "";
		i += 1;
	}
	flushBuf();
	return out.length > 0 ? out : [{ text: line }];
}

/** Split plain text spans on bare `http(s)://` URLs. */
export function splitBareUrls(text: string): LinkSegment[] {
	if (!text.includes("http")) {
		return [{ text }];
	}
	const out: LinkSegment[] = [];
	let last = 0;
	for (const m of text.matchAll(BARE_URL_RE)) {
		const idx = m.index ?? 0;
		if (idx > last) {
			out.push({ text: text.slice(last, idx) });
		}
		const url = m[0] ?? "";
		out.push({ text: url, href: url });
		last = idx + url.length;
	}
	if (last < text.length) {
		out.push({ text: text.slice(last) });
	}
	return out.length > 0 ? out : [{ text }];
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
function splitItalicInPlain(text: string): InlinePiece[] {
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

function parseBoldItalicPieces(text: string): InlinePiece[] {
	const boldParts = parseBoldSegments(text);
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

function attachHref(pieces: InlinePiece[], href: string): InlinePiece[] {
	return pieces.map((piece) => ({ ...piece, href }));
}

export function parseInlineMarkdownPieces(line: string): InlinePiece[] {
	const out: InlinePiece[] = [];
	for (const linkSeg of splitMarkdownLinks(line)) {
		const segments = linkSeg.href ? [linkSeg] : splitBareUrls(linkSeg.text);
		for (const segment of segments) {
			const styled = parseBoldItalicPieces(segment.text);
			out.push(
				...(segment.href ? attachHref(styled, segment.href) : styled),
			);
		}
	}
	return out.length > 0 ? out : [{ bold: false, italic: false, text: "" }];
}

type InlineRenderGroup =
	| {
			readonly kind: "text";
			readonly pieces: readonly (InlinePiece & { readonly color?: string })[];
	  }
	| {
			readonly kind: "link";
			readonly href: string;
			readonly pieces: readonly (InlinePiece & { readonly color?: string })[];
	  };

function groupInlinePiecesForRender(
	pieces: readonly (InlinePiece & { readonly color?: string })[],
): InlineRenderGroup[] {
	const groups: InlineRenderGroup[] = [];
	for (const piece of pieces) {
		if (piece.href) {
			const last = groups.at(-1);
			if (last?.kind === "link" && last.href === piece.href) {
				groups[groups.length - 1] = {
					kind: "link",
					href: piece.href,
					pieces: [...last.pieces, piece],
				};
				continue;
			}
			groups.push({ kind: "link", href: piece.href, pieces: [piece] });
			continue;
		}
		const last = groups.at(-1);
		if (last?.kind === "text") {
			groups[groups.length - 1] = {
				kind: "text",
				pieces: [...last.pieces, piece],
			};
			continue;
		}
		groups.push({ kind: "text", pieces: [piece] });
	}
	return groups;
}

function renderStyledText(
	piece: InlinePiece & { readonly color?: string },
	idx: number,
	options: InlineRenderOptions,
): ReactElement {
	const pieceKey = `${piece.bold}-${piece.italic}-${piece.color ?? ""}-${piece.href ?? ""}-${idx}-${piece.text}`;
	const color =
		options.pieceColor?.(piece) ??
		(piece.href ? LINK_COLOR : options.headingColor);
	return (
		<Text
			key={pieceKey}
			bold={options.heading ? true : piece.bold}
			italic={piece.italic}
			dimColor={options.dimColor}
			color={color}
			underline={piece.href ? true : undefined}
		>
			{piece.text}
		</Text>
	);
}

export function renderInlineMarkdownChildren(
	pieces: readonly (InlinePiece & { readonly color?: string })[],
	options?: InlineRenderOptions,
): ReactNode[] {
	const renderOptions = options ?? {};
	const nodes: ReactNode[] = [];
	for (const [groupIdx, group] of groupInlinePiecesForRender(pieces).entries()) {
		if (group.kind === "text") {
			for (const [pieceIdx, piece] of group.pieces.entries()) {
				nodes.push(renderStyledText(piece, groupIdx * 100 + pieceIdx, renderOptions));
			}
			continue;
		}
		nodes.push(
			<Link key={`link-${groupIdx}-${group.href}`} url={group.href}>
				{group.pieces.map((piece, pieceIdx) =>
					renderStyledText(piece, groupIdx * 100 + pieceIdx, renderOptions),
				)}
			</Link>,
		);
	}
	return nodes;
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
			{renderInlineMarkdownChildren(pieces, {
				heading: heading !== null,
				headingColor,
				dimColor: props.dimColor,
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
			{renderInlineMarkdownChildren(pieces, {
				heading: heading !== null,
				headingColor,
				dimColor: props.dimColor,
			})}
		</Text>
	);
}
