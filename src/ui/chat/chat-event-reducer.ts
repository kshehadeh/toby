import type { AskUserToolResult } from "../../ai/ask-user-tool";
import type { ChatEvent } from "../../chat-pipeline/chat-events";
import { formatToolFeedbackOutput } from "./tool-feedback-registry";
import { getToolDisplayLabel } from "./tool-labels";
import type { ToolRunEntry, TranscriptEntry } from "./types";

function summarizeArgsForHeader(
	toolName: string,
	args: Record<string, unknown>,
): string {
	if (toolName === "askUser") {
		return "";
	}
	const id =
		(typeof args.id === "string" && args.id) ||
		(typeof args.messageId === "string" && args.messageId) ||
		(typeof args.taskId === "string" && args.taskId) ||
		(typeof args.userId === "string" && args.userId) ||
		null;
	if (id) {
		const short = id.length > 28 ? `${id.slice(0, 25)}…` : id;
		return ` · ${short}`;
	}
	const q =
		typeof args.query === "string"
			? args.query.trim()
			: typeof args.q === "string"
				? args.q.trim()
				: "";
	if (q) {
		const short = q.length > 36 ? `${q.slice(0, 33)}…` : q;
		return ` · “${short}”`;
	}
	return "";
}

export function formatToolCallHeader(
	toolName: string,
	args: Record<string, unknown>,
): string {
	const label = getToolDisplayLabel(toolName);
	return `${label}${summarizeArgsForHeader(toolName, args)}`;
}

function replaceEntry(
	entries: readonly TranscriptEntry[],
	index: number,
	next: TranscriptEntry,
): TranscriptEntry[] {
	const out: TranscriptEntry[] = [...entries];
	out[index] = next;
	return out;
}

function findLastBoxedPrepIndex(
	entries: readonly TranscriptEntry[],
	id: string,
): number {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.kind === "boxed_step" && e.variant === "prep" && e.id === id) {
			return i;
		}
	}
	return -1;
}

function findLastBoxedToolIndex(
	entries: readonly TranscriptEntry[],
	blockKey: string,
): number {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (
			e.kind === "boxed_step" &&
			e.variant === "tool" &&
			(e.toolBlockKey === blockKey ||
				e.toolRuns?.some((run) => run.blockKey === blockKey) === true)
		) {
			return i;
		}
	}
	return -1;
}

function toToolRuns(
	entry: Extract<TranscriptEntry, { kind: "boxed_step" }>,
): ToolRunEntry[] {
	if (entry.variant !== "tool") {
		return [];
	}
	if (entry.toolRuns !== undefined && entry.toolRuns.length > 0) {
		return [...entry.toolRuns];
	}
	return [
		{
			blockKey: entry.toolBlockKey ?? entry.id,
			header: entry.header,
			body: entry.body,
			...(entry.cacheHit !== undefined ? { cacheHit: entry.cacheHit } : {}),
		},
	];
}

/**
 * Maps core {@link ChatEvent}s to persisted transcript rows (Ink adapter).
 * Assistant streaming commits are handled in the session layer (not here).
 */
export function applyChatEvent(
	entries: readonly TranscriptEntry[],
	event: ChatEvent,
): TranscriptEntry[] {
	if (event.type === "prep_start") {
		return [
			...entries,
			{
				kind: "boxed_step",
				id: event.id,
				seq: event.seq,
				variant: "prep",
				header: event.header,
				body: "",
			},
		];
	}
	if (event.type === "prep_end") {
		const idx = findLastBoxedPrepIndex(entries, event.id);
		if (idx < 0) {
			return [
				...entries,
				{
					kind: "boxed_step",
					id: event.id,
					seq: event.seq,
					variant: "prep",
					header: "Prompt preparation",
					body: event.detail,
				},
			];
		}
		const cur = entries[idx];
		if (cur.kind !== "boxed_step") {
			return [...entries];
		}
		return replaceEntry(entries, idx, {
			...cur,
			body: event.detail,
			seq: event.seq,
		});
	}
	if (event.type === "tool_call_start") {
		if (event.toolName === "askUser") {
			return [...entries];
		}
		const previous = entries[entries.length - 1];
		if (
			previous?.kind === "boxed_step" &&
			previous.variant === "tool" &&
			previous.toolName === event.toolName
		) {
			const prevRuns = toToolRuns(previous);
			const nextRuns: ToolRunEntry[] = [
				...prevRuns,
				{
					blockKey: event.blockKey,
					header: formatToolCallHeader(event.toolName, event.args),
					body: "",
				},
			];
			const nextHeader = `${getToolDisplayLabel(event.toolName)} (x${nextRuns.length})`;
			return replaceEntry(entries, entries.length - 1, {
				...previous,
				seq: event.seq,
				header: nextHeader,
				body: "",
				toolRuns: nextRuns,
				toolName: event.toolName,
				cacheHit: undefined,
			});
		}
		return [
			...entries,
			{
				kind: "boxed_step",
				id: event.blockKey,
				seq: event.seq,
				variant: "tool",
				header: formatToolCallHeader(event.toolName, event.args),
				body: "",
				toolBlockKey: event.blockKey,
				toolName: event.toolName,
			},
		];
	}
	if (event.type === "tool_call_complete") {
		if (event.toolName === "askUser") {
			const query =
				typeof event.args.query === "string" ? event.args.query : "";
			if (event.error !== undefined) {
				const msg =
					event.error instanceof Error
						? event.error.message
						: String(event.error);
				return [
					...entries,
					{
						kind: "ask_user_qa",
						blockKey: event.blockKey,
						query,
						answer: "",
						error: msg,
					},
				];
			}
			const r = event.result as Partial<AskUserToolResult> | null;
			if (r?.error) {
				return [
					...entries,
					{
						kind: "ask_user_qa",
						blockKey: event.blockKey,
						query,
						answer: "",
						error: r.error,
					},
				];
			}
			const label = (r?.selectedLabel ?? "").trim();
			return [
				...entries,
				{
					kind: "ask_user_qa",
					blockKey: event.blockKey,
					query,
					answer: label,
				},
			];
		}

		const idx = findLastBoxedToolIndex(entries, event.blockKey);
		const detail = formatToolFeedbackOutput({
			toolName: event.toolName,
			args: event.args,
			result: event.result,
			error: event.error,
		});
		if (idx < 0) {
			return [
				...entries,
				{
					kind: "boxed_step",
					id: event.blockKey,
					seq: event.seq,
					variant: "tool",
					header: formatToolCallHeader(event.toolName, event.args),
					body: detail,
					toolBlockKey: event.blockKey,
					toolName: event.toolName,
					...(event.cacheHit !== undefined ? { cacheHit: event.cacheHit } : {}),
				},
			];
		}
		const cur = entries[idx];
		if (cur.kind !== "boxed_step") {
			return [...entries];
		}
		const toolRuns = toToolRuns(cur);
		const runIndex = toolRuns.findIndex(
			(run) => run.blockKey === event.blockKey,
		);
		if (runIndex >= 0) {
			const nextRuns = [...toolRuns];
			nextRuns[runIndex] = {
				...nextRuns[runIndex],
				body: detail,
				...(event.cacheHit !== undefined ? { cacheHit: event.cacheHit } : {}),
			};
			return replaceEntry(entries, idx, {
				...cur,
				seq: event.seq,
				toolName: event.toolName,
				toolRuns: nextRuns,
				...(nextRuns.length > 1
					? {
							header: `${getToolDisplayLabel(event.toolName)} (x${nextRuns.length})`,
							body: "",
							cacheHit: undefined,
						}
					: {
							header: nextRuns[0]?.header ?? cur.header,
							body: nextRuns[0]?.body ?? detail,
							cacheHit: nextRuns[0]?.cacheHit,
						}),
			});
		}
		return replaceEntry(entries, idx, {
			...cur,
			body: detail,
			seq: event.seq,
			toolName: event.toolName,
			...(event.cacheHit !== undefined ? { cacheHit: event.cacheHit } : {}),
		});
	}
	return [...entries];
}
