/** Kill switch — set `TOBY_DISABLE_COMPACTION=1` to skip all compaction. */
export function isCompactionDisabled(): boolean {
	return process.env.TOBY_DISABLE_COMPACTION === "1";
}

/** Fraction of the model context window reserved for the prompt target. */
export function compactionTargetRatio(): number {
	const raw = process.env.TOBY_COMPACTION_TARGET_RATIO?.trim();
	if (raw) {
		const n = Number(raw);
		if (Number.isFinite(n) && n > 0.2 && n < 0.95) {
			return n;
		}
	}
	return 0.75;
}

/** Default context window when the provider catalog does not expose one. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

/** Most-recent tool-call/result pairs left intact by ClearToolResults. */
export const DEFAULT_KEEP_PAIRS = 6;

/**
 * Skip clearing when reclaim would be below this many estimated tokens
 * (avoids busting prompt cache for trivial gains).
 */
export const DEFAULT_MIN_CLEAR_TOKENS = 3_000;

/** Clamp a single message part once its estimated size exceeds this. */
export const DEFAULT_MAX_PART_TOKENS = 50_000;

export const DEFAULT_CLAMP_HEAD_CHARS = 2_000;
export const DEFAULT_CLAMP_TAIL_CHARS = 2_000;

/** Placeholder written over cleared tool results. */
export const CLEARED_TOOL_RESULT_PLACEHOLDER =
	"[tool result cleared — re-run this tool with the same args if needed]";

/**
 * Tool names whose results are never blanked (cannot be safely re-fetched,
 * or represent user-confirmed state).
 */
export const NEVER_CLEAR_TOOLS: ReadonlySet<string> = new Set([
	"askUser",
	"memoryPropose",
	"memoryConfirmProposal",
	"memoryUpdate",
	"memoryForget",
]);

export type CompactionConfig = {
	readonly targetPromptTokens: number;
	readonly keepPairs: number;
	readonly minClearTokens: number;
	readonly maxPartTokens: number;
	readonly clampHeadChars: number;
	readonly clampTailChars: number;
	readonly neverClearTools: ReadonlySet<string>;
	readonly clearedPlaceholder: string;
};

export function resolveCompactionConfig(params: {
	readonly contextWindowTokens?: number;
}): CompactionConfig {
	const window =
		typeof params.contextWindowTokens === "number" &&
		Number.isFinite(params.contextWindowTokens) &&
		params.contextWindowTokens > 0
			? params.contextWindowTokens
			: DEFAULT_CONTEXT_WINDOW_TOKENS;
	const target = Math.max(1_000, Math.floor(window * compactionTargetRatio()));
	return {
		targetPromptTokens: target,
		keepPairs: DEFAULT_KEEP_PAIRS,
		minClearTokens: DEFAULT_MIN_CLEAR_TOKENS,
		maxPartTokens: DEFAULT_MAX_PART_TOKENS,
		clampHeadChars: DEFAULT_CLAMP_HEAD_CHARS,
		clampTailChars: DEFAULT_CLAMP_TAIL_CHARS,
		neverClearTools: NEVER_CLEAR_TOOLS,
		clearedPlaceholder: CLEARED_TOOL_RESULT_PLACEHOLDER,
	};
}
