import type { LanguageModelUsage } from "ai";
import { getCacheAdapter } from "./registry";
import type { ChatCacheContext, TokenUsageReport } from "./types";

export function defaultTokenUsageReport(
	usage: LanguageModelUsage,
	context: Pick<ChatCacheContext, "persona">,
): TokenUsageReport {
	const details = usage.inputTokenDetails;
	return {
		providerId: context.persona.ai.provider,
		model: context.persona.ai.model,
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		totalTokens: usage.totalTokens,
		cacheReadTokens: details?.cacheReadTokens,
		cacheWriteTokens: details?.cacheWriteTokens,
		noCacheTokens: details?.noCacheTokens,
	};
}

export function extractTokenUsageReport(
	usage: LanguageModelUsage | null | undefined,
	context: Pick<ChatCacheContext, "persona"> &
		Partial<Pick<ChatCacheContext, "moduleNames">>,
): TokenUsageReport | null {
	if (!usage?.outputTokens) {
		return null;
	}

	const fullContext: ChatCacheContext = {
		persona: context.persona,
		moduleNames: context.moduleNames ?? [],
	};
	const adapter = getCacheAdapter(fullContext.persona.ai.provider);
	const base = defaultTokenUsageReport(usage, fullContext);
	if (adapter?.normalizeUsageReport) {
		return adapter.normalizeUsageReport({ ...fullContext, usage });
	}
	return base;
}

/** Status-line token summary for the chat input dock. */
export function formatTokenUsageStatus(
	report: TokenUsageReport | null,
): string | null {
	if (!report?.outputTokens) {
		return null;
	}

	const pieces = [
		report.inputTokens !== undefined ? `in=${report.inputTokens}` : null,
		report.outputTokens !== undefined ? `out=${report.outputTokens}` : null,
		report.totalTokens !== undefined ? `tot=${report.totalTokens}` : null,
		report.cacheReadTokens !== undefined
			? `cache=${report.cacheReadTokens}`
			: null,
		report.cacheWriteTokens !== undefined && report.cacheWriteTokens > 0
			? `cacheW=${report.cacheWriteTokens}`
			: null,
	].filter(Boolean);

	return pieces.length > 0 ? pieces.join(" ") : null;
}

/** Verbose cache breakdown for `TOBY_DEBUG_CACHE=1` transcript meta lines. */
export function formatCacheDebugMeta(report: TokenUsageReport): string | null {
	const pieces = [
		report.cacheReadTokens !== undefined
			? `cacheRead=${report.cacheReadTokens}`
			: null,
		report.cacheWriteTokens !== undefined
			? `cacheWrite=${report.cacheWriteTokens}`
			: null,
		report.noCacheTokens !== undefined
			? `noCache=${report.noCacheTokens}`
			: null,
	].filter(Boolean);
	return pieces.length > 0 ? pieces.join(" · ") : null;
}
