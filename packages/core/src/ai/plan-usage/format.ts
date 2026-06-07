import type { AIProviderPlanUsage } from "./types";

function formatUsd(amount: number): string {
	return `$${amount.toFixed(2)}`;
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
