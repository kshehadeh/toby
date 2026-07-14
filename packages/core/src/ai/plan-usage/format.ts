import type { AIProviderPlanUsage } from "./types";

function formatUsd(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

/** Returns the display label for total spent, or "N/A" when unavailable. */
export function formatTotalSpentLabel(
	usage: AIProviderPlanUsage | null | undefined,
): string {
	if (usage?.totalSpentLabel) return usage.totalSpentLabel;
	if (usage?.totalSpent !== undefined) return formatUsd(usage.totalSpent);
	return "N/A";
}

/** Returns the display label for remaining balance, or "N/A" when unavailable. */
export function formatRemainingLabel(
	usage: AIProviderPlanUsage | null | undefined,
): string {
	if (usage?.remainingLabel) return usage.remainingLabel;
	if (usage?.remaining !== undefined) return formatUsd(usage.remaining);
	return "N/A";
}

/** Status-line summary for chat footer, e.g. `$4.50 used · $95.50 left`. */
export function formatPlanUsageStatusLine(
	usage: AIProviderPlanUsage | null | undefined,
): string | null {
	if (!usage?.supported) {
		return null;
	}
	if (usage.unavailableReason) {
		return null;
	}

	const pieces: string[] = [];
	if (usage.totalSpent !== undefined) {
		pieces.push(`${formatUsd(usage.totalSpent)} used`);
	}
	if (usage.remaining !== undefined) {
		pieces.push(`${formatUsd(usage.remaining)} left`);
	}

	return pieces.length > 0 ? pieces.join(" · ") : null;
}

/** Human-readable summary for settings UI, e.g. `$4.50 used · $95.50 left` or `N/A`. */
export function formatPlanUsageSummary(
	usage: AIProviderPlanUsage | null | undefined,
): string {
	if (!usage?.supported || usage.unavailableReason) {
		return "N/A";
	}

	const pieces: string[] = [];
	if (usage.totalSpent !== undefined) {
		pieces.push(`${formatUsd(usage.totalSpent)} used`);
	}
	if (usage.remaining !== undefined) {
		pieces.push(`${formatUsd(usage.remaining)} left`);
	}

	return pieces.length > 0 ? pieces.join(" · ") : "N/A";
}
