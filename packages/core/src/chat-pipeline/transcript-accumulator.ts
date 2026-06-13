import { randomUUID } from "node:crypto";
import type { ChatEvent } from "./chat-events";
import type { TranscriptEntry } from "./transcript-types";
import {
	applyPersistedChatEvent,
	shouldPersistChatEventInTranscript,
} from "./transcript-reducer";

export { shouldPersistChatEventInTranscript, applyPersistedChatEvent };

/**
 * Mutable transcript accumulator for daemon/API turns.
 * Applies the shared transcript reducer and handles assistant streaming segments.
 */
export class TranscriptAccumulator {
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

	addNotice(text: string, tone?: "info" | "success" | "error"): void {
		this.entries = [...this.entries, { kind: "notice", text, tone }];
	}

	addError(text: string): void {
		this.entries = [...this.entries, { kind: "error", text }];
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
		if (shouldPersistChatEventInTranscript(event)) {
			this.entries = applyPersistedChatEvent(this.entries, event);
		}
	}
}
