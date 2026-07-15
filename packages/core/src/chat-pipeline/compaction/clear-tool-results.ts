import type { CoreMessage } from "../../ai/chat";
import { blankToolResultRefs } from "./blank-result";
import { collectToolResultPairs } from "./pairing";

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

	return blankToolResultRefs(messages, toClear, {
		placeholder: opts.placeholder,
		minClearTokens: opts.minClearTokens,
	});
}
