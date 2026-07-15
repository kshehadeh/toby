import type { CoreMessage } from "../../ai/chat";
import { clampOversizedMessages } from "./clamp";
import { clearOldToolResults } from "./clear-tool-results";
import type { CompactionConfig } from "./config";
import { estimateMessagesTokens } from "./estimate";

export type CompactionStrategyName = "clamp" | "clear_tool_results";

export type TieredCompactionResult = {
	readonly messages: CoreMessage[];
	readonly tokensBefore: number;
	readonly tokensAfter: number;
	readonly changed: boolean;
	readonly strategiesApplied: readonly CompactionStrategyName[];
	readonly clampedParts: number;
	readonly clearedToolResults: number;
};

/**
 * Cheap-first compaction: clamp oversized parts, then clear old tool results.
 * Stops as soon as estimated tokens fit `targetPromptTokens`.
 */
export function applyTieredCompaction(
	messages: readonly CoreMessage[],
	config: CompactionConfig,
): TieredCompactionResult {
	const tokensBefore = estimateMessagesTokens(messages);
	if (tokensBefore <= config.targetPromptTokens) {
		return {
			messages: [...messages],
			tokensBefore,
			tokensAfter: tokensBefore,
			changed: false,
			strategiesApplied: [],
			clampedParts: 0,
			clearedToolResults: 0,
		};
	}

	const strategiesApplied: CompactionStrategyName[] = [];
	let current = [...messages] as CoreMessage[];
	let clampedParts = 0;
	let clearedToolResults = 0;

	// Tier 0: always try clamp when over budget (also handles single runaway parts).
	const clamped = clampOversizedMessages(current, {
		maxPartTokens: config.maxPartTokens,
		keepHeadChars: config.clampHeadChars,
		keepTailChars: config.clampTailChars,
	});
	if (clamped.changed) {
		current = clamped.messages;
		clampedParts = clamped.clampedParts;
		strategiesApplied.push("clamp");
	}

	let tokensAfter = estimateMessagesTokens(current);
	if (tokensAfter <= config.targetPromptTokens) {
		return {
			messages: current,
			tokensBefore,
			tokensAfter,
			changed: strategiesApplied.length > 0,
			strategiesApplied,
			clampedParts,
			clearedToolResults,
		};
	}

	// Tier 1: clear old tool results.
	const cleared = clearOldToolResults(current, {
		keepPairs: config.keepPairs,
		minClearTokens: config.minClearTokens,
		neverClearTools: config.neverClearTools,
		placeholder: config.clearedPlaceholder,
	});
	if (cleared.changed) {
		current = cleared.messages;
		clearedToolResults = cleared.clearedCount;
		strategiesApplied.push("clear_tool_results");
	}

	tokensAfter = estimateMessagesTokens(current);
	return {
		messages: current,
		tokensBefore,
		tokensAfter,
		changed: strategiesApplied.length > 0,
		strategiesApplied,
		clampedParts,
		clearedToolResults,
	};
}
