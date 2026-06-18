import { isHiddenLifecycleHeader } from "@toby/core/pipeline-footer";
import {
	ASSISTANT_BOX_MARGIN_LEFT,
	BOXED_STEP_BODY_MARGIN_LEFT,
	TOOL_FEEDBACK_DETAIL_INDENT,
} from "./constants";
import { splitTextAndTables } from "./markdown-table";
import {
	ASSISTANT_TRANSCRIPT_GLYPH,
	META_STEP_GLYPH,
	PIPELINE_STEP_GLYPH,
	THINKING_TRANSCRIPT_GLYPH,
} from "./tool-transcript-icons";
import type { DisplayRow, TranscriptEntry } from "./types";
import { WORKING_PLACEHOLDER_SENTINEL } from "./working-placeholder";

/** Maximum visible lines for the thinking block (scrolling window). */
const THINKING_MAX_VISIBLE_LINES = 5;

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
	for (const block of splitTextAndTables(text)) {
		if (block.kind === "table") {
			out.push(...block.lines);
			continue;
		}
		for (const segment of block.text.split(/\r?\n/)) {
			if (segment.length === 0) {
				out.push("");
				continue;
			}
			out.push(...hardWrap(segment, w));
		}
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

function boxedStepHasPendingBody(
	entry: Extract<TranscriptEntry, { kind: "boxed_step" }>,
): boolean {
	if (entry.variant === "tool") {
		const runs = entry.toolRuns;
		if (runs !== undefined && runs.length > 0) {
			return runs.some((run) => run.body.trim() === "");
		}
		return entry.body.trim() === "";
	}
	return entry.body.trim() === "";
}

function bodyLinesLookEmpty(lines: readonly string[]): boolean {
	return lines.every((line) => line.trim() === "");
}

function applyWorkingPlaceholderIfPending(
	entry: Extract<TranscriptEntry, { kind: "boxed_step" }>,
	bodyLines: readonly string[],
	loading: boolean,
): readonly string[] {
	if (!loading || !boxedStepHasPendingBody(entry)) {
		return bodyLines;
	}
	if (bodyLinesLookEmpty(bodyLines)) {
		return [WORKING_PLACEHOLDER_SENTINEL];
	}
	if (
		entry.variant === "tool" &&
		entry.toolRuns !== undefined &&
		entry.toolRuns.length > 0
	) {
		return [...bodyLines, WORKING_PLACEHOLDER_SENTINEL];
	}
	return bodyLines;
}

function flattenGroupedToolRunLines(
	runs: readonly { header: string; body: string; cacheHit?: boolean }[],
	termCols: number,
): string[] {
	const groups: {
		header: string;
		body: string;
		cacheHit?: boolean;
		count: number;
	}[] = [];
	for (const run of runs) {
		const body = run.body.trim();
		const existing = groups.find(
			(group) =>
				group.header === run.header &&
				group.body === body &&
				group.cacheHit === run.cacheHit,
		);
		if (existing) {
			existing.count += 1;
			continue;
		}
		groups.push({
			header: run.header,
			body,
			...(run.cacheHit !== undefined ? { cacheHit: run.cacheHit } : {}),
			count: 1,
		});
	}

	if (groups.length === 1) {
		const group = groups[0];
		if (group?.body) {
			return flattenBoxedBodyLines(group.body, termCols);
		}
		if (group) {
			const title = `${group.header}${group.cacheHit ? " [cache]" : ""}`;
			return flattenBoxedBodyLines(title, termCols);
		}
	}

	const lines: string[] = [];
	for (let idx = 0; idx < groups.length; idx++) {
		const group = groups[idx];
		if (group === undefined) {
			continue;
		}
		const title = `${idx + 1}. ${group.header}${group.cacheHit ? " [cache]" : ""}${group.count > 1 ? ` (x${group.count})` : ""}`;
		lines.push(...flattenBoxedBodyLines(title, termCols));
		if (group.body.length > 0) {
			for (const line of flattenBoxedBodyLines(group.body, termCols)) {
				lines.push(`   ${line}`);
			}
		}
		if (idx < groups.length - 1) {
			lines.push("");
		}
	}
	return lines.length > 0 ? lines : [""];
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

function capBodyLines(
	lines: readonly string[],
	variant:
		| "prep"
		| "lifecycle"
		| "assistant"
		| "assistant_interim"
		| "tool"
		| "plan"
		| "meta"
		| "thinking",
): readonly string[] {
	if (variant === "lifecycle" || variant === "prep" || variant === "meta") {
		return lines;
	}
	if (variant === "thinking" || variant === "assistant_interim") {
		if (lines.length <= THINKING_MAX_VISIBLE_LINES) {
			return lines;
		}
		const hiddenCount = lines.length - THINKING_MAX_VISIBLE_LINES;
		const capped = lines.slice(-THINKING_MAX_VISIBLE_LINES);
		return [`↑ ${hiddenCount} line(s) hidden`, ...capped];
	}
	if (variant === "assistant" || lines.length <= 3) {
		return lines;
	}
	const capped = lines.slice(-3);
	const firstContent = capped.findIndex((line) => line.length > 0);
	return firstContent > 0 ? capped.slice(firstContent) : capped;
}

export function flattenTranscript(
	entries: readonly TranscriptEntry[],
	streamingText: string,
	streamingReasoning: string,
	loading: boolean,
	termCols: number,
	streamingHeader = "Toby",
	debug = false,
): DisplayRow[] {
	const userContentWidth = Math.max(8, termCols - 1);
	const assistantW = assistantInnerTextWidth(termCols);
	const rows: DisplayRow[] = [];
	let gapKey = 0;
	let assistantBlockSeq = 0;
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (
			!debug &&
			e.kind === "boxed_step" &&
			e.variant === "lifecycle" &&
			isHiddenLifecycleHeader(e.header)
		) {
			continue;
		}
		if (!debug && e.kind === "boxed_step" && e.variant === "prep") {
			continue;
		}
		if (
			!debug &&
			e.kind === "boxed_step" &&
			e.variant === "assistant_interim"
		) {
			continue;
		}
		if (!debug && e.kind === "meta") {
			continue;
		}
		if (!debug && e.kind === "turn_work") {
			continue;
		}
		const next = entries[i + 1];
		if (e.kind === "user") {
			for (const line of hardWrap(e.text, userContentWidth)) {
				rows.push({ kind: "user", text: line });
			}
			const gapBeforeReply =
				next?.kind === "assistant" ||
				next?.kind === "boxed_step" ||
				next?.kind === "tool_call";
			if (gapBeforeReply) {
				gapKey += 1;
				rows.push({ kind: "spacer", rowKey: `gap-${gapKey}` });
			}
		} else if (e.kind === "boxed_step") {
			const leadingGlyph =
				e.variant === "tool"
					? PIPELINE_STEP_GLYPH
					: e.variant === "thinking"
						? THINKING_TRANSCRIPT_GLYPH
						: e.variant === "prep" || e.variant === "lifecycle"
							? PIPELINE_STEP_GLYPH
							: e.variant === "plan"
								? "◆"
								: ASSISTANT_TRANSCRIPT_GLYPH;
			let bodyLines: readonly string[] =
				e.variant === "tool" &&
				e.toolRuns !== undefined &&
				e.toolRuns.length > 1
					? flattenGroupedToolRunLines(e.toolRuns, termCols)
					: flattenBoxedBodyLines(e.body, termCols);
			bodyLines = capBodyLines(bodyLines, e.variant);
			if (e.variant !== "thinking") {
				bodyLines = applyWorkingPlaceholderIfPending(e, bodyLines, loading);
			}
			rows.push({
				kind: "boxed_block",
				id: e.id,
				variant: e.variant,
				header: e.header,
				bodyLines,
				leadingGlyph,
				...(e.integrationLabel !== undefined
					? { integrationLabel: e.integrationLabel }
					: {}),
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
			const hasOutput =
				next?.kind === "tool_output" && next.blockKey === e.blockKey;
			if (loading && !hasOutput) {
				rows.push({
					kind: "tool_feedback_output",
					blockKey: e.blockKey,
					detail: WORKING_PLACEHOLDER_SENTINEL,
				});
			}
			const skipGapBeforePairedOutput = hasOutput;
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
		} else if (e.kind === "notice") {
			let groupEnd = i;
			while (groupEnd < entries.length) {
				const maybeNotice = entries[groupEnd];
				if (maybeNotice?.kind !== "notice") {
					break;
				}
				const insetCols = Math.max(8, termCols - 2);
				for (const line of hardWrap(maybeNotice.text, insetCols)) {
					rows.push({
						kind: "notice",
						text: line,
						...(maybeNotice.tone !== undefined
							? { tone: maybeNotice.tone }
							: {}),
					});
				}
				groupEnd += 1;
			}
			const entryAfterNoticeGroup = entries[groupEnd];
			if (entryAfterNoticeGroup !== undefined) {
				gapKey += 1;
				rows.push({ kind: "spacer", rowKey: `gap-${gapKey}` });
			}
			i = groupEnd - 1;
		} else if (e.kind === "meta") {
			const metaBodyLines: string[] = [];
			let groupEnd = i;
			while (groupEnd < entries.length) {
				const maybeMeta = entries[groupEnd];
				if (maybeMeta?.kind !== "meta") {
					break;
				}
				metaBodyLines.push(...flattenBoxedBodyLines(maybeMeta.text, termCols));
				groupEnd += 1;
			}
			rows.push({
				kind: "boxed_block",
				id: `meta-${i}-${groupEnd - 1}`,
				variant: "meta",
				header: "Session note",
				bodyLines: metaBodyLines.length > 0 ? metaBodyLines : [""],
				leadingGlyph: META_STEP_GLYPH,
			});
			const entryAfterMetaGroup = entries[groupEnd];
			if (entryAfterMetaGroup !== undefined) {
				gapKey += 1;
				rows.push({ kind: "spacer", rowKey: `gap-${gapKey}` });
			}
			i = groupEnd - 1;
		} else if (e.kind === "error") {
			// Match pipeline / user body inset (see `buildTranscriptNodes` error margins).
			const insetCols = Math.max(8, termCols - 2);
			for (const line of hardWrap(e.text, insetCols)) {
				rows.push({ kind: "error", text: line });
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
	if (loading && streamingReasoning.length > 0) {
		const last = entries[entries.length - 1];
		if (last?.kind === "user") {
			gapKey += 1;
			rows.push({ kind: "spacer", rowKey: `gap-${gapKey}` });
		}
		const reasoningLines = flattenBoxedBodyLines(streamingReasoning, termCols);
		const visibleLines =
			reasoningLines.length > THINKING_MAX_VISIBLE_LINES
				? [
						`↑ ${reasoningLines.length - THINKING_MAX_VISIBLE_LINES} line(s) hidden`,
						...reasoningLines.slice(-THINKING_MAX_VISIBLE_LINES),
					]
				: reasoningLines;
		rows.push({
			kind: "boxed_block",
			id: "thinking-stream",
			variant: "thinking",
			header: "Thinking",
			bodyLines: visibleLines.length > 0 ? visibleLines : [""],
			leadingGlyph: THINKING_TRANSCRIPT_GLYPH,
		});
	}
	return rows;
}
