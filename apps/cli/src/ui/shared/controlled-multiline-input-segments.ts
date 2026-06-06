export type CursorStyle = "block" | "bar";

export type SegmentType = "text" | "placeholder" | "highlight" | "cursor";

export interface TextSegment {
	readonly value: string;
	readonly type?: SegmentType;
}

export interface BuildInputSegmentsOptions {
	readonly value: string;
	readonly cursorIndex: number;
	readonly focus: boolean;
	readonly showCursor: boolean;
	readonly cursorVisible: boolean;
	readonly cursorStyle: CursorStyle;
	readonly cursorGlyph: string;
	readonly placeholder: string;
	readonly highlight?: { readonly start: number; readonly end: number };
	readonly formatText: (text: string, isPlaceholder?: boolean) => string;
}

function formatCursorChar(
	value: string,
	cursorIndex: number,
	formatText: BuildInputSegmentsOptions["formatText"],
): string {
	const raw = value[cursorIndex];
	if (raw === undefined || raw === "\n") {
		return " ";
	}
	return formatText(raw);
}

function isCursorInHighlight(
	highlight: { readonly start: number; readonly end: number },
	cursorIndex: number,
): boolean {
	return cursorIndex >= highlight.start && cursorIndex < highlight.end;
}

function barCursorSegment(
	showCursor: boolean,
	focus: boolean,
	cursorVisible: boolean,
	cursorGlyph: string,
): TextSegment {
	if (!showCursor || !focus) {
		return { value: "" };
	}
	return {
		value: cursorVisible ? cursorGlyph : " ",
		type: cursorVisible ? "cursor" : undefined,
	};
}

function blockCursorSegment(
	value: string,
	cursorIndex: number,
	showCursor: boolean,
	focus: boolean,
	cursorVisible: boolean,
	formatText: BuildInputSegmentsOptions["formatText"],
	highlight?: { readonly start: number; readonly end: number },
	onCurrentLine = false,
): TextSegment {
	if (!showCursor || !focus) {
		return { value: "" };
	}
	const char = formatCursorChar(value, cursorIndex, formatText);
	if (cursorVisible) {
		return { value: char, type: "cursor" };
	}
	if (highlight && isCursorInHighlight(highlight, cursorIndex)) {
		return { value: char, type: "highlight" };
	}
	if (onCurrentLine) {
		return { value: char, type: "highlight" };
	}
	return { value: char };
}

function buildBarSegments(
	value: string,
	cursorIndex: number,
	highlight: { readonly start: number; readonly end: number } | undefined,
	formatText: BuildInputSegmentsOptions["formatText"],
	cursorSegment: TextSegment,
): { preCursor: TextSegment[]; postCursor: TextSegment[] } {
	const textBefore = value.slice(0, cursorIndex);
	const textAfter = value.slice(cursorIndex);

	if (!highlight) {
		const formattedBefore = formatText(textBefore);
		const formattedAfter = formatText(textAfter);
		const lineStart = formattedBefore.lastIndexOf("\n") + 1;
		const lineEnd = formattedAfter.indexOf("\n");
		return {
			preCursor: [
				{ value: formattedBefore.slice(0, lineStart) },
				{ value: formattedBefore.slice(lineStart), type: "highlight" },
				cursorSegment,
			],
			postCursor: [
				{ value: formattedAfter.slice(0, lineEnd), type: "highlight" },
				{ value: formattedAfter.slice(lineEnd) },
			],
		};
	}

	return {
		preCursor: [
			{ value: formatText(textBefore.slice(0, highlight.start)) },
			{
				value: formatText(
					textBefore.slice(
						highlight.start,
						Math.min(highlight.end, cursorIndex),
					),
				),
				type: "highlight",
			},
			{ value: formatText(textBefore.slice(highlight.end)) },
			cursorSegment,
		],
		postCursor: [
			{
				value: formatText(
					textAfter.slice(0, Math.max(highlight.start - cursorIndex, 0)),
				),
			},
			{
				value: formatText(
					textAfter.slice(
						Math.max(highlight.start - cursorIndex, 0),
						Math.max(highlight.end - cursorIndex, 0),
					),
				),
				type: "highlight",
			},
			{
				value: formatText(
					textAfter.slice(Math.max(highlight.end - cursorIndex, 0)),
				),
			},
		],
	};
}

function buildBlockSegments(
	value: string,
	cursorIndex: number,
	highlight: { readonly start: number; readonly end: number } | undefined,
	options: BuildInputSegmentsOptions,
): { preCursor: TextSegment[]; postCursor: TextSegment[] } {
	const { showCursor, focus, cursorVisible, formatText } = options;
	const textBefore = value.slice(0, cursorIndex);
	const textAfter = value.slice(cursorIndex + 1);
	const cursorSegment = blockCursorSegment(
		value,
		cursorIndex,
		showCursor,
		focus,
		cursorVisible,
		formatText,
		highlight,
		!highlight,
	);

	if (!highlight) {
		const formattedBefore = formatText(textBefore);
		const formattedAfter = formatText(textAfter);
		const lineStart = formattedBefore.lastIndexOf("\n") + 1;
		const lineEnd = formattedAfter.indexOf("\n");
		return {
			preCursor: [
				{ value: formattedBefore.slice(0, lineStart) },
				{ value: formattedBefore.slice(lineStart), type: "highlight" },
				cursorSegment,
			],
			postCursor: [
				{ value: formattedAfter.slice(0, lineEnd), type: "highlight" },
				{ value: formattedAfter.slice(lineEnd) },
			],
		};
	}

	const afterHighlightStart = Math.max(highlight.start - cursorIndex - 1, 0);
	const afterHighlightEnd = Math.max(highlight.end - cursorIndex - 1, 0);

	return {
		preCursor: [
			{ value: formatText(textBefore.slice(0, highlight.start)) },
			{
				value: formatText(
					textBefore.slice(
						highlight.start,
						Math.min(highlight.end, cursorIndex),
					),
				),
				type: "highlight",
			},
			{ value: formatText(textBefore.slice(highlight.end)) },
			cursorSegment,
		],
		postCursor: [
			{
				value: formatText(textAfter.slice(0, afterHighlightStart)),
			},
			{
				value: formatText(
					textAfter.slice(afterHighlightStart, afterHighlightEnd),
				),
				type: "highlight",
			},
			{
				value: formatText(textAfter.slice(afterHighlightEnd)),
			},
		],
	};
}

export function buildInputSegments(
	options: BuildInputSegmentsOptions,
): { preCursor: TextSegment[]; postCursor: TextSegment[] } {
	const {
		value,
		cursorIndex,
		focus,
		showCursor,
		cursorVisible,
		cursorStyle,
		cursorGlyph,
		placeholder,
		highlight,
		formatText,
	} = options;

	if (!value) {
		if (placeholder && !focus) {
			return {
				preCursor: [
					{ value: formatText(placeholder, true), type: "placeholder" },
				],
				postCursor: [],
			};
		}
		if (cursorStyle === "block") {
			return {
				preCursor: [
					blockCursorSegment(
						value,
						0,
						showCursor,
						focus,
						cursorVisible,
						formatText,
					),
				],
				postCursor: [],
			};
		}
		return {
			preCursor: [
				barCursorSegment(showCursor, focus, cursorVisible, cursorGlyph),
			],
			postCursor: [],
		};
	}

	if (!focus) {
		return {
			preCursor: [{ value: formatText(value) }],
			postCursor: [],
		};
	}

	const hasValidHighlight =
		highlight &&
		highlight.end > highlight.start &&
		highlight.start >= 0 &&
		highlight.end <= value.length;

	const activeHighlight = hasValidHighlight ? highlight : undefined;

	if (cursorStyle === "block") {
		return buildBlockSegments(value, cursorIndex, activeHighlight, options);
	}

	return buildBarSegments(
		value,
		cursorIndex,
		activeHighlight,
		formatText,
		barCursorSegment(showCursor, focus, cursorVisible, cursorGlyph),
	);
}

export function segmentsToPlainText(segments: readonly TextSegment[]): string {
	return segments.map((segment) => segment.value).join("");
}
