import type { AskUserToolResult } from "../ai/ask-user-tool";
import { getToolDisplayLabel } from "../tool-labels";
import type { ChatEvent } from "./chat-events";
import type { ToolRunEntry, TranscriptEntry } from "./transcript-types";

export type ToolOutputFormatContext = {
	readonly toolName: string;
	readonly args: Record<string, unknown>;
	readonly result: unknown;
	readonly error?: unknown;
};

export type ToolOutputFormatter = (ctx: ToolOutputFormatContext) => string;

let toolOutputFormatter: ToolOutputFormatter = defaultToolOutputFormatter;

/** Override compact tool output formatting (e.g. Ink registers richer formatters). */
export function setToolOutputFormatter(formatter: ToolOutputFormatter): void {
	toolOutputFormatter = formatter;
}

export function formatToolOutput(ctx: ToolOutputFormatContext): string {
	return toolOutputFormatter(ctx);
}

function sanitizeOneLine(value: string, maxLen = 200): string {
	return value.replace(/\r?\n/g, " ").trim().slice(0, maxLen);
}

function defaultToolOutputFormatter(ctx: ToolOutputFormatContext): string {
	if (ctx.error !== undefined) {
		const msg =
			ctx.error instanceof Error ? ctx.error.message : String(ctx.error);
		return sanitizeOneLine(`Failed: ${msg}`);
	}
	const result = ctx.result;
	if (Array.isArray(result)) {
		return `Returned ${result.length} item(s).`;
	}
	if (result && typeof result === "object") {
		const record = result as Record<string, unknown>;
		if (
			typeof record.message === "string" &&
			record.message.trim().length > 0
		) {
			return sanitizeOneLine(record.message);
		}
		if (
			typeof record.summary === "string" &&
			record.summary.trim().length > 0
		) {
			return sanitizeOneLine(record.summary);
		}
		if (record.success === true) {
			return "Done.";
		}
	}
	return "Done.";
}

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
	integrationLabel?: string,
): string {
	const label = getToolDisplayLabel(toolName);
	const prefix = integrationLabel ? `${integrationLabel}: ` : "";
	return `${prefix}${label}${summarizeArgsForHeader(toolName, args)}`;
}

function formatGroupedToolHeader(
	toolName: string,
	count: number,
	integrationLabel?: string,
): string {
	const prefix = integrationLabel ? `${integrationLabel}: ` : "";
	return `${prefix}${getToolDisplayLabel(toolName)} (x${count})`;
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

function findLastBoxedStepIndex(
	entries: readonly TranscriptEntry[],
	id: string,
	variant: "prep" | "lifecycle",
): number {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.kind === "boxed_step" && e.variant === variant && e.id === id) {
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

const HIDDEN_LIFECYCLE_HEADERS = new Set([
	"Sending request to model…",
	"Updating session messages…",
	"Saving session…",
	"Preparing Session…",
]);

function isHiddenLifecycleHeader(header: string): boolean {
	return HIDDEN_LIFECYCLE_HEADERS.has(header);
}

/** Whether a pipeline event should be stored in the persisted transcript. */
export function shouldPersistChatEventInTranscript(ev: ChatEvent): boolean {
	if (ev.type === "prep_start" || ev.type === "prep_end") {
		return false;
	}
	if (ev.type === "lifecycle_start" && isHiddenLifecycleHeader(ev.header)) {
		return false;
	}
	if (ev.type === "lifecycle_end") {
		return false;
	}
	if (ev.type === "lifecycle_append" || ev.type === "lifecycle_set") {
		return false;
	}
	if (ev.type === "plan_amended" || ev.type === "plan_completed") {
		return false;
	}
	if (ev.type === "ask_user_prompt") {
		return false;
	}
	return true;
}

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
		const idx = findLastBoxedStepIndex(entries, event.id, "prep");
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
	if (event.type === "lifecycle_start") {
		return [
			...entries,
			{
				kind: "boxed_step",
				id: event.id,
				seq: event.seq,
				variant: "lifecycle",
				header: event.header,
				body: "",
			},
		];
	}
	if (event.type === "lifecycle_append") {
		const idx = findLastBoxedStepIndex(entries, event.id, "lifecycle");
		if (idx < 0) {
			return [...entries];
		}
		const cur = entries[idx];
		if (cur.kind !== "boxed_step") {
			return [...entries];
		}
		const nextBody =
			cur.body.trim().length > 0 ? `${cur.body}\n${event.line}` : event.line;
		return replaceEntry(entries, idx, {
			...cur,
			body: nextBody,
			seq: event.seq,
		});
	}
	if (event.type === "lifecycle_set") {
		const idx = findLastBoxedStepIndex(entries, event.id, "lifecycle");
		if (idx < 0) {
			return [...entries];
		}
		const cur = entries[idx];
		if (cur.kind !== "boxed_step") {
			return [...entries];
		}
		return replaceEntry(entries, idx, {
			...cur,
			body: event.line,
			seq: event.seq,
		});
	}
	if (event.type === "lifecycle_end") {
		const idx = findLastBoxedStepIndex(entries, event.id, "lifecycle");
		if (idx < 0) {
			return [
				...entries,
				{
					kind: "boxed_step",
					id: event.id,
					seq: event.seq,
					variant: "lifecycle",
					header: "Pipeline",
					body: event.detail,
				},
			];
		}
		const cur = entries[idx];
		if (cur.kind !== "boxed_step") {
			return [...entries];
		}
		const nextBody =
			cur.body.trim().length > 0
				? `${cur.body}\n${event.detail}`
				: event.detail;
		return replaceEntry(entries, idx, {
			...cur,
			body: nextBody,
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
					header: formatToolCallHeader(
						event.toolName,
						event.args,
						event.integrationLabel,
					),
					body: "",
				},
			];
			const nextHeader = formatGroupedToolHeader(
				event.toolName,
				nextRuns.length,
				event.integrationLabel ?? previous.integrationLabel,
			);
			return replaceEntry(entries, entries.length - 1, {
				...previous,
				seq: event.seq,
				header: nextHeader,
				body: "",
				toolRuns: nextRuns,
				toolName: event.toolName,
				...(event.integrationLabel !== undefined
					? { integrationLabel: event.integrationLabel }
					: {}),
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
				header: formatToolCallHeader(
					event.toolName,
					event.args,
					event.integrationLabel,
				),
				body: "",
				toolBlockKey: event.blockKey,
				toolName: event.toolName,
				...(event.integrationLabel !== undefined
					? { integrationLabel: event.integrationLabel }
					: {}),
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
		const detail = formatToolOutput({
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
					header: formatToolCallHeader(
						event.toolName,
						event.args,
						event.integrationLabel,
					),
					body: detail,
					toolBlockKey: event.blockKey,
					toolName: event.toolName,
					...(event.integrationLabel !== undefined
						? { integrationLabel: event.integrationLabel }
						: {}),
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
				...(event.integrationLabel !== undefined
					? { integrationLabel: event.integrationLabel }
					: {}),
				...(nextRuns.length > 1
					? {
							header: formatGroupedToolHeader(
								event.toolName,
								nextRuns.length,
								event.integrationLabel ?? cur.integrationLabel,
							),
							body: "",
							cacheHit: undefined,
						}
					: {
							header:
								event.integrationLabel !== undefined ||
								cur.integrationLabel !== undefined
									? formatToolCallHeader(
											event.toolName,
											event.args,
											event.integrationLabel ?? cur.integrationLabel,
										)
									: (nextRuns[0]?.header ?? cur.header),
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
			...(event.integrationLabel !== undefined
				? { integrationLabel: event.integrationLabel }
				: {}),
			...(event.cacheHit !== undefined ? { cacheHit: event.cacheHit } : {}),
		});
	}
	if (event.type === "plan_created") {
		const phaseList = Array.from(
			{ length: event.phaseCount },
			(_, i) => `  ${i + 1}. (pending)`,
		).join("\n");
		return [
			...entries,
			{
				kind: "boxed_step",
				id: event.id,
				seq: event.seq,
				variant: "plan" as const,
				header: `Plan: ${event.goal}`,
				body: `Phases:\n${phaseList}`,
			},
		];
	}
	if (event.type === "plan_phase_start") {
		return [
			...entries,
			{
				kind: "boxed_step",
				id: event.phaseId,
				seq: event.seq,
				variant: "lifecycle" as const,
				header: `Phase ${event.index + 1}/${event.total}: ${event.label}`,
				body: "",
			},
		];
	}
	if (event.type === "plan_phase_end") {
		const statusLabel: Record<string, string> = {
			completed: "Completed",
			skipped: "Skipped",
			failed: "Failed",
			in_progress: "In progress",
			pending: "Pending",
		};
		const idx = findLastBoxedStepIndex(entries, event.phaseId, "lifecycle");
		if (idx < 0) {
			return [
				...entries,
				{
					kind: "boxed_step",
					id: event.phaseId,
					seq: event.seq,
					variant: "lifecycle" as const,
					header: "Phase",
					body: statusLabel[event.status] ?? event.status,
				},
			];
		}
		const cur = entries[idx];
		if (cur.kind !== "boxed_step") {
			return [...entries];
		}
		return replaceEntry(entries, idx, {
			...cur,
			body: statusLabel[event.status] ?? event.status,
			seq: event.seq,
		});
	}
	if (event.type === "plan_amended" || event.type === "plan_completed") {
		return [...entries];
	}
	if (event.type === "transcript_notice") {
		return [
			...entries,
			{
				kind: "notice",
				text: event.text,
				...(event.tone !== undefined ? { tone: event.tone } : {}),
			},
		];
	}
	return [...entries];
}

export function applyPersistedChatEvent(
	entries: readonly TranscriptEntry[],
	event: ChatEvent,
): TranscriptEntry[] {
	if (!shouldPersistChatEventInTranscript(event)) {
		return [...entries];
	}
	return applyChatEvent(entries, event);
}
