import {
	type SessionTokenTotals,
	extractTokenUsageReport,
	formatSessionTokenCount,
	sessionTokenTotalTokens,
} from "@toby/core/ai/caching";
import type { AIContextWindowInfo } from "@toby/core/ai/context-window";
import type { AIProviderPlanUsage } from "@toby/core/ai/plan-usage";
import { getAIProviderDisplayName } from "@toby/core/ai/providers";
import type { Persona } from "@toby/core/config/index";
import type { LanguageModelUsage } from "ai";
import type { HelpKeyRow } from "./help-sections";

export type UsageSections = {
	readonly providerPlan: readonly HelpKeyRow[];
	readonly activeSession: readonly HelpKeyRow[];
	readonly lastTurn: readonly HelpKeyRow[];
	readonly notes: readonly string[];
};

function formatUsd(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

function formatContextFill(
	contextWindow: AIContextWindowInfo | null,
): string | null {
	if (!contextWindow?.supported) {
		return null;
	}
	if (typeof contextWindow.fillPercentage !== "number") {
		return null;
	}
	return `${contextWindow.fillPercentage}% of context window`;
}

function buildProviderPlanRows(
	planUsage: AIProviderPlanUsage | null,
	persona: Persona,
	loading: boolean,
): HelpKeyRow[] {
	const providerLabel = getAIProviderDisplayName(persona.ai.provider);
	const rows: HelpKeyRow[] = [
		{ label: "Provider", keys: providerLabel },
		{ label: "Model", keys: persona.ai.model },
	];

	if (loading && !planUsage) {
		rows.push({ label: "Plan usage", keys: "Loading…" });
		return rows;
	}

	if (!planUsage) {
		rows.push({ label: "Plan usage", keys: "Unavailable" });
		return rows;
	}

	if (!planUsage.supported) {
		rows.push({
			label: "Plan usage",
			keys: planUsage.unavailableReason ?? "Not available for this provider.",
		});
		return rows;
	}

	if (planUsage.unavailableReason) {
		rows.push({ label: "Plan usage", keys: planUsage.unavailableReason });
		return rows;
	}

	if (planUsage.totalSpent !== undefined) {
		rows.push({ label: "Total spent", keys: formatUsd(planUsage.totalSpent) });
	}
	if (planUsage.remaining !== undefined) {
		rows.push({ label: "Remaining", keys: formatUsd(planUsage.remaining) });
	}
	rows.push({
		label: "Updated",
		keys: new Date(planUsage.fetchedAt).toLocaleString(),
	});

	return rows;
}

function buildActiveSessionRows(
	sessionName: string,
	totals: SessionTokenTotals,
): HelpKeyRow[] {
	const rows: HelpKeyRow[] = [
		{ label: "Session", keys: sessionName },
		{ label: "Completed turns", keys: String(totals.turnCount) },
		{
			label: "Input tokens",
			keys: formatSessionTokenCount(totals.inputTokens),
		},
		{
			label: "Output tokens",
			keys: formatSessionTokenCount(totals.outputTokens),
		},
		{
			label: "Total tokens",
			keys: formatSessionTokenCount(sessionTokenTotalTokens(totals)),
		},
	];

	if (totals.cacheReadTokens > 0) {
		rows.push({
			label: "Cache read",
			keys: formatSessionTokenCount(totals.cacheReadTokens),
		});
	}
	if (totals.cacheWriteTokens > 0) {
		rows.push({
			label: "Cache write",
			keys: formatSessionTokenCount(totals.cacheWriteTokens),
		});
	}

	return rows;
}

function buildLastTurnRows(
	persona: Persona,
	lastUsage: LanguageModelUsage | null,
	contextWindow: AIContextWindowInfo | null,
): HelpKeyRow[] {
	const report = extractTokenUsageReport(lastUsage, { persona });
	if (!report?.outputTokens) {
		return [{ label: "Last turn", keys: "No completed turns yet" }];
	}

	const rows: HelpKeyRow[] = [
		{
			label: "Input",
			keys: formatSessionTokenCount(report.inputTokens),
		},
		{
			label: "Output",
			keys: formatSessionTokenCount(report.outputTokens),
		},
	];

	if (report.totalTokens !== undefined) {
		rows.push({
			label: "Total",
			keys: formatSessionTokenCount(report.totalTokens),
		});
	}

	const contextFill = formatContextFill(contextWindow);
	if (contextFill) {
		rows.push({ label: "Context fill", keys: contextFill });
	} else if (contextWindow?.supported === false) {
		rows.push({
			label: "Context fill",
			keys:
				contextWindow.unavailableReason ??
				"Provider doesn't support context window information.",
		});
	}

	if (report.cacheReadTokens !== undefined && report.cacheReadTokens > 0) {
		rows.push({
			label: "Cache read",
			keys: formatSessionTokenCount(report.cacheReadTokens),
		});
	}
	if (report.cacheWriteTokens !== undefined && report.cacheWriteTokens > 0) {
		rows.push({
			label: "Cache write",
			keys: formatSessionTokenCount(report.cacheWriteTokens),
		});
	}

	return rows;
}

export function buildUsageSections(options: {
	readonly persona: Persona;
	readonly sessionName: string;
	readonly sessionTokenTotals: SessionTokenTotals;
	readonly lastUsage: LanguageModelUsage | null;
	readonly contextWindow: AIContextWindowInfo | null;
	readonly planUsage: AIProviderPlanUsage | null;
	readonly planUsageLoading: boolean;
}): UsageSections {
	const notes: string[] = [
		"Session totals include completed model turns in this chat.",
		"Plan usage reflects provider billing APIs when available.",
	];

	if (options.persona.ai.provider === "openai") {
		notes.push(
			"OpenAI does not expose remaining balance via API keys. Check the OpenAI dashboard for account usage.",
		);
	}

	return {
		providerPlan: buildProviderPlanRows(
			options.planUsage,
			options.persona,
			options.planUsageLoading,
		),
		activeSession: buildActiveSessionRows(
			options.sessionName,
			options.sessionTokenTotals,
		),
		lastTurn: buildLastTurnRows(
			options.persona,
			options.lastUsage,
			options.contextWindow,
		),
		notes,
	};
}
