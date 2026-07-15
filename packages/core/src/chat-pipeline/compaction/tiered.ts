import type { CoreMessage } from "../../ai/chat";
import { clampOversizedMessages } from "./clamp";
import { clearOldToolResults } from "./clear-tool-results";
import type { CompactionConfig } from "./config";
import { dedupeSupersededToolResults } from "./dedupe-results";
import { estimateMessagesTokens } from "./estimate";

export type CompactionStrategyName =
	| "clamp"
	| "dedupe_results"
	| "clear_tool_results";

export type TieredCompactionResult = {
	readonly messages: CoreMessage[];
	readonly tokensBefore: number;
	readonly tokensAfter: number;
	readonly changed: boolean;
	readonly strategiesApplied: readonly CompactionStrategyName[];
	readonly clampedParts: number;
	readonly dedupedToolResults: number;
	readonly clearedToolResults: number;
};

/**
 * Cheap-first compaction: clamp → dedupe superseded reads → clear old tool results.
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
			dedupedToolResults: 0,
			clearedToolResults: 0,
		};
	}

	const strategiesApplied: CompactionStrategyName[] = [];
	let current = [...messages] as CoreMessage[];
	let clampedParts = 0;
	let dedupedToolResults = 0;
	let clearedToolResults = 0;

	// Tier 0: clamp oversized parts (handles single runaway generation).
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
			dedupedToolResults,
			clearedToolResults,
		};
	}

	// Tier 1: blank superseded re-fetches of the same resource.
	const deduped = dedupeSupersededToolResults(current, {
		minClearTokens: config.minClearTokens,
		neverClearTools: config.neverClearTools,
		clearedPlaceholder: config.clearedPlaceholder,
	});
	if (deduped.changed) {
		current = deduped.messages;
		dedupedToolResults = deduped.dedupedCount;
		strategiesApplied.push("dedupe_results");
	}

	tokensAfter = estimateMessagesTokens(current);
	if (tokensAfter <= config.targetPromptTokens) {
		return {
			messages: current,
			tokensBefore,
			tokensAfter,
			changed: strategiesApplied.length > 0,
			strategiesApplied,
			clampedParts,
			dedupedToolResults,
			clearedToolResults,
		};
	}

	// Tier 2: clear oldest tool results beyond keep_pairs.
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
		dedupedToolResults,
		clearedToolResults,
	};
}
