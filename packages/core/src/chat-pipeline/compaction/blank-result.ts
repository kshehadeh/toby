import type { CoreMessage } from "../../ai/chat";
import { estimateMessagesTokens, estimateTextTokens } from "./estimate";
import {
	type ToolPairRef,
	getToolResultPayload,
	isToolResultPart,
} from "./pairing";

export function clearedToolOutput(placeholder: string): {
	type: "text";
	value: string;
} {
	return { type: "text", value: placeholder };
}

export function estimatePayloadTokens(payload: unknown): number {
	if (payload == null) return 0;
	if (typeof payload === "string") return estimateTextTokens(payload);
	try {
		return estimateTextTokens(JSON.stringify(payload));
	} catch {
		return estimateTextTokens(String(payload));
	}
}

export type BlankToolResultsResult = {
	readonly messages: CoreMessage[];
	readonly clearedCount: number;
	readonly reclaimedTokens: number;
	readonly changed: boolean;
};

/**
 * Blank the given tool-result parts in place (pairing preserved).
 * Skips when projected reclaim is below `minClearTokens`.
 */
export function blankToolResultRefs(
	messages: readonly CoreMessage[],
	toClear: readonly ToolPairRef[],
	opts: {
		readonly placeholder: string;
		readonly minClearTokens: number;
	},
): BlankToolResultsResult {
	if (toClear.length === 0) {
		return {
			messages: [...messages],
			clearedCount: 0,
			reclaimedTokens: 0,
			changed: false,
		};
	}

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
			const base = { ...part } as Record<string, unknown>;
			base.output = clearedToolOutput(opts.placeholder);
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
