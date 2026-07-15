import type { CoreMessage } from "../../ai/chat";
import { blankToolResultRefs } from "./blank-result";
import {
	type ToolPairRef,
	collectToolResultPairs,
	isToolCallPart,
} from "./pairing";
import { resultKey } from "./result-keys";

export const SUPERSEDED_TOOL_RESULT_PLACEHOLDER =
	"[superseded tool result — a newer call for this resource is later in the conversation; re-run if needed]";

export type DedupeToolResultsOptions = {
	readonly minClearTokens: number;
	readonly neverClearTools: ReadonlySet<string>;
	/** Placeholder for age-based clears; used to detect already-cleared parts. */
	readonly clearedPlaceholder: string;
	readonly supersededPlaceholder?: string;
};

export type DedupeToolResultsResult = {
	readonly messages: CoreMessage[];
	readonly dedupedCount: number;
	readonly reclaimedTokens: number;
	readonly changed: boolean;
};

function buildToolCallArgsById(
	messages: readonly CoreMessage[],
): Map<string, { toolName: string; args: unknown }> {
	const map = new Map<string, { toolName: string; args: unknown }>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		const content = message.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (!isToolCallPart(part)) continue;
			const args =
				"input" in part && part.input !== undefined
					? part.input
					: "args" in part
						? part.args
						: undefined;
			map.set(part.toolCallId, { toolName: part.toolName, args });
		}
	}
	return map;
}

/**
 * Blank tool results that are superseded by a later result for the same
 * resource key. Keeps the newest result for each key; preserves pairing.
 */
export function dedupeSupersededToolResults(
	messages: readonly CoreMessage[],
	opts: DedupeToolResultsOptions,
): DedupeToolResultsResult {
	const placeholder =
		opts.supersededPlaceholder ?? SUPERSEDED_TOOL_RESULT_PLACEHOLDER;
	const pairs = collectToolResultPairs(messages, opts.clearedPlaceholder);
	if (pairs.length < 2) {
		return {
			messages: [...messages],
			dedupedCount: 0,
			reclaimedTokens: 0,
			changed: false,
		};
	}

	const callArgs = buildToolCallArgsById(messages);

	// key → list of pairs in chronological order
	const byKey = new Map<string, ToolPairRef[]>();
	for (const pair of pairs) {
		if (opts.neverClearTools.has(pair.toolName)) continue;
		if (opts.neverClearTools.has(pair.toolName.toLowerCase())) continue;
		if (pair.alreadyCleared) continue;

		const call = callArgs.get(pair.toolCallId);
		const toolName = call?.toolName ?? pair.toolName;
		const args = call?.args ?? {};
		const key = resultKey(toolName, args);
		if (!key) continue;

		const list = byKey.get(key) ?? [];
		list.push(pair);
		byKey.set(key, list);
	}

	const toBlank: ToolPairRef[] = [];
	for (const list of byKey.values()) {
		if (list.length < 2) continue;
		// Keep the last (newest); blank all earlier.
		for (let i = 0; i < list.length - 1; i++) {
			const ref = list[i];
			if (ref) toBlank.push(ref);
		}
	}

	const blanked = blankToolResultRefs(messages, toBlank, {
		placeholder,
		minClearTokens: opts.minClearTokens,
	});

	return {
		messages: blanked.messages,
		dedupedCount: blanked.clearedCount,
		reclaimedTokens: blanked.reclaimedTokens,
		changed: blanked.changed,
	};
}
