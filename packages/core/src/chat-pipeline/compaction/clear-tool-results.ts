import type { CoreMessage } from "../../ai/chat";
import { estimateMessagesTokens, estimateTextTokens } from "./estimate";
import {
	collectToolResultPairs,
	getToolResultPayload,
	isToolResultPart,
} from "./pairing";

export type ClearToolResultsOptions = {
	readonly keepPairs: number;
	readonly minClearTokens: number;
	readonly neverClearTools: ReadonlySet<string>;
	readonly placeholder: string;
};

export type ClearToolResultsResult = {
	readonly messages: CoreMessage[];
	readonly clearedCount: number;
	readonly reclaimedTokens: number;
	readonly changed: boolean;
};

function clearedOutput(placeholder: string): {
	type: "text";
	value: string;
} {
	return { type: "text", value: placeholder };
}

function estimatePayloadTokens(payload: unknown): number {
	if (payload == null) return 0;
	if (typeof payload === "string") return estimateTextTokens(payload);
	try {
		return estimateTextTokens(JSON.stringify(payload));
	} catch {
		return estimateTextTokens(String(payload));
	}
}

/**
 * Blank the content of oldest tool results, keeping the most recent
 * `keepPairs` pairs intact. Tool-call / tool-result pairing is preserved.
 */
export function clearOldToolResults(
	messages: readonly CoreMessage[],
	opts: ClearToolResultsOptions,
): ClearToolResultsResult {
	const pairs = collectToolResultPairs(messages, opts.placeholder);
	if (pairs.length === 0) {
		return {
			messages: [...messages],
			clearedCount: 0,
			reclaimedTokens: 0,
			changed: false,
		};
	}

	const keep = Math.max(0, opts.keepPairs);
	const clearable = pairs.slice(0, Math.max(0, pairs.length - keep));
	const toClear = clearable.filter(
		(p) =>
			!p.alreadyCleared &&
			!opts.neverClearTools.has(p.toolName) &&
			!opts.neverClearTools.has(p.toolName.toLowerCase()),
	);

	if (toClear.length === 0) {
		return {
			messages: [...messages],
			clearedCount: 0,
			reclaimedTokens: 0,
			changed: false,
		};
	}

	// Pre-check reclaim size so we can skip trivial clears (cache tradeoff).
	let projectedReclaim = 0;
	for (const ref of toClear) {
		const message = messages[ref.resultMessageIndex];
		const content = message?.content;
		if (!Array.isArray(content)) continue;
		const part = content[ref.resultPartIndex];
		if (!isToolResultPart(part)) continue;
		const payload = getToolResultPayload(part);
		const before = estimatePayloadTokens(payload);
		const after = estimateTextTokens(opts.placeholder);
		projectedReclaim += Math.max(0, before - after);
	}

	if (projectedReclaim < opts.minClearTokens) {
		return {
			messages: [...messages],
			clearedCount: 0,
			reclaimedTokens: 0,
			changed: false,
		};
	}

	const clearSet = new Set(
		toClear.map((p) => `${p.resultMessageIndex}:${p.resultPartIndex}`),
	);

	const tokensBefore = estimateMessagesTokens(messages);
	let clearedCount = 0;
	const next = messages.map((message, mi) => {
		const content = message.content;
		if (!Array.isArray(content)) return message;
		if (message.role !== "tool" && message.role !== "assistant") {
			return message;
		}
		let partChanged = false;
		const parts = content.map((part, pi) => {
			if (!clearSet.has(`${mi}:${pi}`)) return part;
			if (!isToolResultPart(part)) return part;
			clearedCount += 1;
			partChanged = true;
			// Prefer AI SDK v5+ shape (`output`); keep `result` cleared if present for legacy.
			const base = { ...part } as Record<string, unknown>;
			base.output = clearedOutput(opts.placeholder);
			if ("result" in base) {
				base.result = opts.placeholder;
			}
			return base;
		});
		if (!partChanged) return message;
		return { ...message, content: parts } as CoreMessage;
	});

	const tokensAfter = estimateMessagesTokens(next);
	return {
		messages: next,
		clearedCount,
		reclaimedTokens: Math.max(0, tokensBefore - tokensAfter),
		changed: clearedCount > 0,
	};
}
