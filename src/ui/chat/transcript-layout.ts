import {
	ASSISTANT_BOX_MARGIN_LEFT,
	BOXED_STEP_BODY_MARGIN_LEFT,
	TOOL_FEEDBACK_DETAIL_INDENT,
} from "./constants";
import {
	ASSISTANT_TRANSCRIPT_GLYPH,
	getToolTranscriptGlyph,
} from "./tool-transcript-icons";
import type { DisplayRow, TranscriptEntry } from "./types";

/** Break a string into lines of at most `max` columns (prefer spaces). */
function hardWrap(line: string, max: number): string[] {
	if (max < 8) {
		return [line];
	}
	if (line.length <= max) {
		return [line];
	}
	const out: string[] = [];
	let rest = line;
	while (rest.length > 0) {
		if (rest.length <= max) {
			out.push(rest);
			break;
		}
		let chunk = rest.slice(0, max);
		const lastSpace = chunk.lastIndexOf(" ");
		if (lastSpace > Math.floor(max * 0.55)) {
			chunk = rest.slice(0, lastSpace);
			rest = rest.slice(lastSpace + 1).trimStart();
		} else {
			rest = rest.slice(max);
		}
		out.push(chunk);
	}
	return out;
}

/** Split on newlines, then word-wrap each paragraph so every visual line can be indented consistently. */
function wrapAssistantBlock(text: string, innerWidth: number): string[] {
	const w = Math.max(8, innerWidth);
	const out: string[] = [];
	for (const segment of text.split(/\r?\n/)) {
		if (segment.length === 0) {
			out.push("");
			continue;
		}
		out.push(...hardWrap(segment, w));
	}
	return out;
}

/** Text columns available inside the bordered assistant box (margin + border + padding). */
function assistantInnerTextWidth(termCols: number): number {
	return Math.max(8, termCols - ASSISTANT_BOX_MARGIN_LEFT - 4);
}

function boxedStepBodyWrapWidth(termCols: number): number {
	return Math.max(8, termCols - 2 - BOXED_STEP_BODY_MARGIN_LEFT - 4 - 2);
}

function flattenBoxedBodyLines(text: string, termCols: number): string[] {
	const w = boxedStepBodyWrapWidth(termCols);
	const lines: string[] = [];
	for (const segment of text.split(/\r?\n/)) {
		if (segment.length === 0) {
			lines.push("");
			continue;
		}
		lines.push(...hardWrap(segment, w));
	}
	return lines;
}

type AssistantSegment =
	| { kind: "text"; text: string }
	| { kind: "list_item"; text: string; marker: string };

function parseAssistantSegments(text: string): AssistantSegment[] {
	const segments: AssistantSegment[] = [];
	const lines = text.split(/\r?\n/);
	let orderedIndex = 0;

	const flushTextLine = (line: string) => {
		orderedIndex = 0;
		segments.push({ kind: "text", text: line });
	};

	for (const line of lines) {
		const checkboxMatch = line.match(/^\s*[-*]\s+\[(?: |x|X)\]\s+(.*)$/);
		const unorderedMatch = line.match(/^\s*[-*•]\s+(.*)$/);
		const orderedMatch = line.match(/^\s*(\d+)[.)]\s+(.*)$/);

		if (checkboxMatch?.[1]) {
			orderedIndex = 0;
			segments.push({
				kind: "list_item",
				text: checkboxMatch[1].trim(),
				marker: "•",
			});
			continue;
		}

		if (unorderedMatch?.[1]) {
			orderedIndex = 0;
			segments.push({
				kind: "list_item",
				text: unorderedMatch[1].trim(),
				marker: "•",
			});
			continue;
		}

		if (orderedMatch?.[2]) {
			const parsed = Number.parseInt(orderedMatch[1] ?? "", 10);
			const itemNumber = Number.isNaN(parsed) ? orderedIndex + 1 : parsed;
			orderedIndex = itemNumber;
			segments.push({
				kind: "list_item",
				text: orderedMatch[2].trim(),
				marker: `${itemNumber}.`,
			});
			continue;
		}

		if (line.trim() === "") {
			flushTextLine("");
			continue;
		}

		flushTextLine(line);
	}

	return segments;
}

export function flattenTranscript(
	entries: readonly TranscriptEntry[],
	streamingText: string,
	loading: boolean,
	termCols: number,
	streamingHeader = "Toby",
): DisplayRow[] {
	const userContentWidth = Math.max(8, termCols - 1);
	const assistantW = assistantInnerTextWidth(termCols);
	const rows: DisplayRow[] = [];
	let gapKey = 0;
	let assistantBlockSeq = 0;
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		const next = entries[i + 1];
		if (e.kind === "user") {
			for (const line of hardWrap(e.text, userContentWidth)) {
				rows.push({ kind: "user", text: line });
			}
			const gapBeforeReply =
				next?.kind === "assistant" ||
				(next?.kind === "boxed_step" && next.variant !== "prep") ||
				next?.kind === "tool_call";
			if (gapBeforeReply) {
				gapKey += 1;
				rows.push({ kind: "spacer", rowKey: `gap-${gapKey}` });
			}
		} else if (e.kind === "boxed_step") {
			if (e.variant === "prep") {
				continue;
			}
			const leadingGlyph =
				e.variant === "tool"
					? getToolTranscriptGlyph(e.toolName ?? "")
					: ASSISTANT_TRANSCRIPT_GLYPH;
			rows.push({
				kind: "boxed_block",
				id: e.id,
				variant: e.variant,
				header: e.header,
				bodyLines: flattenBoxedBodyLines(e.body, termCols),
				leadingGlyph,
				...(e.cacheHit !== undefined ? { cacheHit: e.cacheHit } : {}),
			});
			if (next !== undefined) {
				gapKey += 1;
				rows.push({ kind: "spacer", rowKey: `gap-${gapKey}` });
			}
		} else if (e.kind === "assistant") {
			assistantBlockSeq += 1;
			const blockKey = `asst-${assistantBlockSeq}`;
			const segments = parseAssistantSegments(e.text);
			for (const segment of segments) {
				if (segment.kind === "text") {
					const lines = wrapAssistantBlock(segment.text, assistantW);
					if (lines.length === 0) {
						rows.push({ kind: "assistant_line", text: "", blockKey });
					} else {
						for (const line of lines) {
							rows.push({ kind: "assistant_line", text: line, blockKey });
						}
					}
					continue;
				}

				const markerPad = `${segment.marker} `;
				const wrapped = hardWrap(
					segment.text,
					Math.max(6, assistantW - markerPad.length),
				);
				if (wrapped.length === 0) {
					rows.push({
						kind: "assistant_list_item",
						text: "",
						marker: markerPad,
						blockKey,
					});
					continue;
				}
				for (let idx = 0; idx < wrapped.length; idx++) {
					rows.push({
						kind: "assistant_list_item",
						text: wrapped[idx] ?? "",
						marker: idx === 0 ? markerPad : " ".repeat(markerPad.length),
						blockKey,
					});
				}
			}
			if (next !== undefined) {
				gapKey += 1;
				rows.push({ kind: "spacer", rowKey: `gap-${gapKey}` });
			}
		} else if (e.kind === "tool_call") {
			rows.push({
				kind: "tool_feedback_call",
				blockKey: e.blockKey,
				title: e.title,
			});
			const skipGapBeforePairedOutput =
				next?.kind === "tool_output" && next.blockKey === e.blockKey;
			if (next !== undefined && !skipGapBeforePairedOutput) {
				gapKey += 1;
				rows.push({ kind: "spacer", rowKey: `gap-${gapKey}` });
			}
		} else if (e.kind === "tool_output") {
			const outWidth = Math.max(8, termCols - TOOL_FEEDBACK_DETAIL_INDENT);
			for (const line of hardWrap(e.detail, outWidth)) {
				rows.push({
					kind: "tool_feedback_output",
					blockKey: e.blockKey,
					detail: line,
				});
			}
			if (next !== undefined) {
				gapKey += 1;
				rows.push({ kind: "spacer", rowKey: `gap-${gapKey}` });
			}
		} else if (e.kind === "ask_user_qa") {
			rows.push({
				kind: "ask_user_qa",
				blockKey: e.blockKey,
				query: e.query,
				answer: e.answer,
				...(e.error !== undefined ? { error: e.error } : {}),
			});
			if (next !== undefined) {
				gapKey += 1;
				rows.push({ kind: "spacer", rowKey: `gap-${gapKey}` });
			}
		} else {
			for (const line of hardWrap(e.text, termCols)) {
				rows.push({ kind: e.kind, text: line });
			}
		}
	}
	if (loading && streamingText.length > 0) {
		const last = entries[entries.length - 1];
		if (last?.kind === "user") {
			gapKey += 1;
			rows.push({ kind: "spacer", rowKey: `gap-${gapKey}` });
		}
		const streamLines: string[] = [];
		const streamSegments = parseAssistantSegments(streamingText);
		for (const segment of streamSegments) {
			if (segment.kind === "text") {
				streamLines.push(...wrapAssistantBlock(segment.text, assistantW));
				continue;
			}
			const markerPad = `${segment.marker} `;
			const wrapped = hardWrap(
				segment.text,
				Math.max(6, assistantW - markerPad.length),
			);
			if (wrapped.length === 0) {
				streamLines.push(`${markerPad}`);
			} else {
				for (let idx = 0; idx < wrapped.length; idx++) {
					streamLines.push(
						`${idx === 0 ? markerPad : " ".repeat(markerPad.length)}${wrapped[idx] ?? ""}`,
					);
				}
			}
		}
		rows.push({
			kind: "boxed_block",
			id: "asst-stream",
			variant: "assistant",
			header: streamingHeader,
			bodyLines: streamLines.length > 0 ? streamLines : [""],
			leadingGlyph: ASSISTANT_TRANSCRIPT_GLYPH,
		});
	}
	return rows;
}
