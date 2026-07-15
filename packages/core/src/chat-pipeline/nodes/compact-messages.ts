import { randomUUID } from "node:crypto";
import { resolveContextWindowInfo } from "../../ai/context-window";
import { logWithSession } from "../../logging/chat-log";
import { replaceSessionMessages } from "../../session-store";
import {
	applyTieredCompaction,
	estimateMessagesTokens,
	isCompactionDisabled,
	resolveCompactionConfig,
} from "../compaction";
import type { AssembledTurn, PipelineNode } from "../pipeline";

function summarizeCompactionActions(params: {
	readonly clampedParts: number;
	readonly dedupedToolResults: number;
	readonly clearedToolResults: number;
}): string {
	const bits: string[] = [];
	if (params.clampedParts > 0) {
		bits.push(
			`clamped ${params.clampedParts} oversized part${params.clampedParts === 1 ? "" : "s"}`,
		);
	}
	if (params.dedupedToolResults > 0) {
		bits.push(
			`deduped ${params.dedupedToolResults} superseded result${params.dedupedToolResults === 1 ? "" : "s"}`,
		);
	}
	if (params.clearedToolResults > 0) {
		bits.push(
			`cleared ${params.clearedToolResults} tool result${params.clearedToolResults === 1 ? "" : "s"}`,
		);
	}
	return bits.length > 0 ? bits.join(", ") : "no changes";
}

/**
 * CompactMessagesNode — keep assembled history under a prompt token budget
 * before the model turn. Zero-LLM strategies (clamp, dedupe, clear).
 */
export const compactMessagesNode: PipelineNode<AssembledTurn, AssembledTurn> = {
	name: "compact-messages",
	async run(input, ctx) {
		if (isCompactionDisabled()) {
			return input;
		}

		const tokensBefore = estimateMessagesTokens(input.messages);
		let contextWindowTokens: number | undefined;
		try {
			const info = await resolveContextWindowInfo({
				providerId: ctx.persona.ai.provider,
				model: ctx.persona.ai.model,
			});
			if (info?.supported) {
				contextWindowTokens = info.contextWindowTokens;
			}
		} catch {
			// Fall through to default window in resolveCompactionConfig.
		}

		const config = resolveCompactionConfig({ contextWindowTokens });
		if (tokensBefore <= config.targetPromptTokens) {
			return input;
		}

		const lifecycleId = randomUUID();
		ctx.emit({
			type: "lifecycle_start",
			id: lifecycleId,
			seq: ctx.nextSeq(),
			header: "Compacting conversation context…",
		});

		try {
			const result = applyTieredCompaction(input.messages, config);
			const actions = summarizeCompactionActions({
				clampedParts: result.clampedParts,
				dedupedToolResults: result.dedupedToolResults,
				clearedToolResults: result.clearedToolResults,
			});
			const detail = result.changed
				? `Context compacted (${actions}); ~${result.tokensBefore} -> ~${result.tokensAfter} tokens.`
				: `Context over budget (~${result.tokensBefore} tokens) but no safe reclaim was available.`;

			ctx.emit({
				type: "lifecycle_end",
				id: lifecycleId,
				seq: ctx.nextSeq(),
				detail,
			});

			if (result.changed) {
				ctx.emit({
					type: "transcript_notice",
					seq: ctx.nextSeq(),
					text: `Context compacted (${actions}).`,
					tone: "info",
				});
			}

			const sid = ctx.persist?.sessionId ?? null;
			logWithSession(sid, undefined, "info", "turn", "compaction", {
				tokensBefore: result.tokensBefore,
				tokensAfter: result.tokensAfter,
				targetPromptTokens: config.targetPromptTokens,
				contextWindowTokens: contextWindowTokens ?? null,
				strategiesApplied: result.strategiesApplied,
				clampedParts: result.clampedParts,
				dedupedToolResults: result.dedupedToolResults,
				clearedToolResults: result.clearedToolResults,
				changed: result.changed,
			});

			if (!result.changed) {
				return input;
			}

			if (ctx.persist) {
				// Rewrite model history so the next load does not rehydrate bloat,
				// and shift append index so PersistTurn only adds response messages.
				replaceSessionMessages(ctx.persist.sessionId, result.messages);
				ctx.persist.startIdx = result.messages.length;
			}

			return {
				...input,
				messages: result.messages,
			};
		} catch (error) {
			ctx.emit({
				type: "lifecycle_end",
				id: lifecycleId,
				seq: ctx.nextSeq(),
				detail: "Context compaction failed; continuing with full history.",
			});
			const sid = ctx.persist?.sessionId ?? null;
			logWithSession(sid, undefined, "warn", "turn", "compaction_error", {
				error: error instanceof Error ? error.message : String(error),
			});
			// Fail open: do not block the turn on compaction bugs.
			return input;
		}
	},
};
