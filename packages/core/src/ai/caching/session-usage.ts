import type { TokenUsageReport } from "./types";

export type SessionTokenTotals = {
	readonly turnCount: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
};

export function emptySessionTokenTotals(): SessionTokenTotals {
	return {
		turnCount: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
}

export function addTurnToSessionTokenTotals(
	totals: SessionTokenTotals,
	report: TokenUsageReport | null,
): SessionTokenTotals {
	if (!report?.outputTokens) {
		return totals;
	}

	return {
		turnCount: totals.turnCount + 1,
		inputTokens: totals.inputTokens + (report.inputTokens ?? 0),
		outputTokens: totals.outputTokens + (report.outputTokens ?? 0),
		cacheReadTokens: totals.cacheReadTokens + (report.cacheReadTokens ?? 0),
		cacheWriteTokens: totals.cacheWriteTokens + (report.cacheWriteTokens ?? 0),
	};
}

export function formatSessionTokenCount(value: number | undefined): string {
	if (value === undefined) {
		return "—";
	}
	return value.toLocaleString();
}

export function sessionTokenTotalTokens(totals: SessionTokenTotals): number {
	return totals.inputTokens + totals.outputTokens;
}
