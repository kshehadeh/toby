import { randomUUID } from "node:crypto";
import { isAbortError } from "@toby/core/abort";
import type { AskUserHandler } from "@toby/core/ai/ask-user-tool";
import {
	type SessionTokenTotals,
	addTurnToSessionTokenTotals,
	extractTokenUsageReport,
} from "@toby/core/ai/caching";
import { formatChatModelError } from "@toby/core/ai/chat-errors";
import type { AIContextWindowInfo } from "@toby/core/ai/context-window";
import type { ChatEvent } from "@toby/core/chat-pipeline/chat-events";
import type { Persona } from "@toby/core/config/index";
import {
	activityLineForChatEvent,
	formatListeningToPersona,
} from "@toby/core/pipeline-footer";
import type { LanguageModelUsage } from "ai";
import type { MutableRefObject } from "react";
import type { DaemonChatBridge } from "./daemon-chat-bridge";
import { buildTurnCancellationNoticeEntry } from "./session-note";
import { applyPersistedChatEvent } from "./transcript-events";
import type { TranscriptEntry } from "./types";

export type DaemonTurnCallbacks = {
	readonly persona: Persona;
	readonly moduleNames: readonly string[];
	readonly onActivityLine: (line: string) => void;
	readonly onLoading: (loading: boolean) => void;
	readonly onStreamingClear: () => void;
	readonly onStreamingDelta: (header: string, text: string) => void;
	readonly onReasoningDelta: (text: string) => void;
	readonly onReasoningCommitted: (id: string, body: string) => void;
	readonly onTranscript: (
		updater: (entries: readonly TranscriptEntry[]) => TranscriptEntry[],
	) => void;
	readonly onUsage: (usage: LanguageModelUsage | null) => void;
	readonly onContextWindow: (contextWindow: AIContextWindowInfo | null) => void;
	readonly onSessionTokenTotals: (
		updater: (prev: SessionTokenTotals) => SessionTokenTotals,
	) => void;
	readonly onSessionName?: (name: string) => void;
	readonly askUserHandler: AskUserHandler;
	readonly nextSeq: () => number;
	readonly sessionIdRef: MutableRefObject<string | null>;
	readonly pendingSteeringPromptRef: MutableRefObject<string | null>;
};

export async function runDaemonChatTurn(params: {
	readonly bridge: DaemonChatBridge;
	readonly sessionId: string;
	readonly userText: string;
	readonly steering?: boolean;
	readonly callbacks: DaemonTurnCallbacks;
}): Promise<{ text: string; cancelled: boolean }> {
	const { bridge, sessionId, userText, steering, callbacks } = params;
	const assistantSegmentHeaderRef = { current: callbacks.persona.name };
	const assistantStreamBufRef = { current: "" };
	let assistantSegmentCommitted = false;

	callbacks.onLoading(true);
	callbacks.onStreamingClear();
	callbacks.onReasoningDelta("");
	callbacks.onActivityLine(formatListeningToPersona(callbacks.persona.name));

	const reasoningStreamBufRef = { current: "" };
	let reasoningSegmentId: string | null = null;

	const emitChatEvent = (ev: ChatEvent) => {
		const footerHint = activityLineForChatEvent(ev, {
			personaName: callbacks.persona.name,
		});
		if (footerHint !== null) {
			callbacks.onActivityLine(footerHint);
		}
		if (ev.type === "reasoning_start") {
			reasoningStreamBufRef.current = "";
			reasoningSegmentId = ev.id;
			return;
		}
		if (ev.type === "reasoning_delta") {
			reasoningStreamBufRef.current += ev.delta;
			callbacks.onReasoningDelta(reasoningStreamBufRef.current);
			return;
		}
		if (ev.type === "reasoning_end") {
			const body = reasoningStreamBufRef.current.trim();
			reasoningStreamBufRef.current = "";
			callbacks.onReasoningDelta("");
			if (body.length > 0) {
				callbacks.onReasoningCommitted(ev.id, body);
			}
			reasoningSegmentId = null;
			return;
		}
		if (ev.type === "assistant_segment_start") {
			assistantSegmentHeaderRef.current = ev.header;
			assistantStreamBufRef.current = "";
			return;
		}
		if (ev.type === "assistant_text_delta") {
			assistantStreamBufRef.current += ev.delta;
			callbacks.onStreamingDelta(
				assistantSegmentHeaderRef.current,
				assistantStreamBufRef.current,
			);
			return;
		}
		if (ev.type === "assistant_segment_end") {
			const body = assistantStreamBufRef.current.trim();
			assistantStreamBufRef.current = "";
			callbacks.onStreamingClear();
			if (body.length > 0) {
				assistantSegmentCommitted = true;
				callbacks.onTranscript((t) => [
					...t,
					{
						kind: "boxed_step",
						id: ev.id,
						seq: callbacks.nextSeq(),
						variant: ev.interim ? "assistant_interim" : "assistant",
						header: assistantSegmentHeaderRef.current,
						body,
					},
				]);
			}
			return;
		}
		callbacks.onTranscript((t) => applyPersistedChatEvent(t, ev));
	};

	try {
		const done = await bridge.submitTurn({
			sessionId,
			text: userText,
			steering,
			onEvent: emitChatEvent,
			onAskUser: async (prompt) =>
				callbacks.askUserHandler({
					query: prompt.query,
					options: [...prompt.options],
				}),
		});

		const reply = done.text?.trim() ?? "";
		if (reply.length > 0 && !assistantSegmentCommitted) {
			callbacks.onTranscript((t) => [
				...t,
				{
					kind: "boxed_step",
					id: randomUUID(),
					seq: callbacks.nextSeq(),
					variant: "assistant",
					header: callbacks.persona.name,
					body: reply,
				},
			]);
		}

		if (done.usage) {
			callbacks.onUsage(done.usage);
			const tokenReport = extractTokenUsageReport(done.usage, {
				persona: callbacks.persona,
				moduleNames: callbacks.moduleNames,
			});
			callbacks.onSessionTokenTotals((totals) =>
				addTurnToSessionTokenTotals(totals, tokenReport),
			);
		}
		callbacks.onContextWindow(done.contextWindow ?? null);

		if (done.sessionName?.trim()) {
			callbacks.onSessionName?.(done.sessionName.trim());
		}

		callbacks.onActivityLine(formatListeningToPersona(callbacks.persona.name));
		return { text: reply, cancelled: false };
	} catch (error) {
		const partial = assistantStreamBufRef.current.trim();
		assistantStreamBufRef.current = "";
		callbacks.onStreamingClear();
		if (partial.length > 0) {
			callbacks.onTranscript((t) => [
				...t,
				{
					kind: "boxed_step",
					id: randomUUID(),
					seq: callbacks.nextSeq(),
					variant: "assistant",
					header: assistantSegmentHeaderRef.current,
					body: partial,
				},
			]);
		}
		if (isAbortError(error)) {
			if (callbacks.pendingSteeringPromptRef.current) {
				return { text: partial, cancelled: true };
			}
			callbacks.onTranscript((t) => [
				...t,
				buildTurnCancellationNoticeEntry(callbacks.sessionIdRef.current),
			]);
			return { text: partial, cancelled: true };
		}
		const msg = formatChatModelError(error);
		callbacks.onTranscript((t) => [...t, { kind: "error", text: msg }]);
		throw error;
	} finally {
		callbacks.onLoading(false);
	}
}
