import { randomUUID } from "node:crypto";
import type { ChatEvent } from "../chat-pipeline/chat-events";
import type { TranscriptEntry } from "../chat-pipeline/transcript-types";
import { getToolDisplayLabel } from "../tool-labels";

function sanitizeOneLine(value: string, maxLen = 200): string {
	return value.replace(/\r?\n/g, " ").trim().slice(0, maxLen);
}

function formatToolOutput(
	event: Extract<ChatEvent, { type: "tool_call_complete" }>,
): string {
	if (event.error !== undefined) {
		const msg =
			event.error instanceof Error ? event.error.message : String(event.error);
		return sanitizeOneLine(`Failed: ${msg}`);
	}
	const result = event.result;
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

function formatToolHeader(
	toolName: string,
	args: Record<string, unknown>,
	integrationLabel?: string,
): string {
	const label = getToolDisplayLabel(toolName);
	const prefix = integrationLabel ? `${integrationLabel}: ` : "";
	const query =
		typeof args.query === "string"
			? args.query.trim()
			: typeof args.q === "string"
				? args.q.trim()
				: "";
	if (query) {
		const short = query.length > 36 ? `${query.slice(0, 33)}…` : query;
		return `${prefix}${label} · “${short}”`;
	}
	return `${prefix}${label}`;
}

export class WebTranscriptAccumulator {
	private entries: TranscriptEntry[] = [];
	private localSeq = 0;
	private assistantHeader = "";
	private assistantBuffer = "";

	constructor(initial: readonly TranscriptEntry[] = []) {
		this.entries = [...initial];
	}

	get snapshot(): readonly TranscriptEntry[] {
		return this.entries;
	}

	addUser(text: string): void {
		this.entries = [...this.entries, { kind: "user", text }];
	}

	addAssistantFallback(header: string, body: string): void {
		const trimmed = body.trim();
		if (trimmed.length === 0) {
			return;
		}
		this.localSeq += 1;
		this.entries = [
			...this.entries,
			{
				kind: "boxed_step",
				id: randomUUID(),
				seq: this.localSeq,
				variant: "assistant",
				header,
				body: trimmed,
			},
		];
	}

	hasAssistantBodyInSlice(body: string, fromIdx: number): boolean {
		const normalized = body.trim();
		return this.entries.slice(fromIdx).some((entry) => {
			if (entry.kind === "assistant") {
				return entry.text.trim() === normalized;
			}
			return (
				entry.kind === "boxed_step" &&
				entry.variant === "assistant" &&
				entry.body.trim() === normalized
			);
		});
	}

	applyEvent(event: ChatEvent): void {
		if (event.type === "assistant_segment_start") {
			this.assistantHeader = event.header;
			this.assistantBuffer = "";
			return;
		}
		if (event.type === "assistant_text_delta") {
			this.assistantBuffer += event.delta;
			return;
		}
		if (event.type === "assistant_segment_end") {
			const body = this.assistantBuffer.trim();
			this.assistantBuffer = "";
			if (body.length === 0) {
				return;
			}
			this.localSeq += 1;
			this.entries = [
				...this.entries,
				{
					kind: "boxed_step",
					id: event.id,
					seq: this.localSeq,
					variant: "assistant",
					header: this.assistantHeader,
					body,
				},
			];
			return;
		}
		if (event.type === "tool_call_complete") {
			if (event.toolName === "askUser") {
				const query =
					typeof event.args.query === "string" ? event.args.query : "";
				const result = event.result as
					| { selectedLabel?: string; error?: string }
					| null
					| undefined;
				this.entries = [
					...this.entries,
					{
						kind: "ask_user_qa",
						blockKey: event.blockKey,
						query,
						answer: (result?.selectedLabel ?? "").trim(),
						...(result?.error ? { error: result.error } : {}),
					},
				];
				return;
			}
			this.localSeq += 1;
			this.entries = [
				...this.entries,
				{
					kind: "boxed_step",
					id: event.blockKey,
					seq: this.localSeq,
					variant: "tool",
					header: formatToolHeader(
						event.toolName,
						event.args,
						event.integrationLabel,
					),
					body: formatToolOutput(event),
					toolBlockKey: event.blockKey,
					toolName: event.toolName,
					...(event.integrationLabel !== undefined
						? { integrationLabel: event.integrationLabel }
						: {}),
					...(event.cacheHit !== undefined ? { cacheHit: event.cacheHit } : {}),
				},
			];
		}
	}
}
