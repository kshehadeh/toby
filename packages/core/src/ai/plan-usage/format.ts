import type { AIProviderPlanUsage } from "./types";

/** Shown when a provider did not report a figure. A reported zero stays `$0.00`. */
const MISSING_AMOUNT = "—";

function formatUsd(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

function formatUsdOrDash(amount: number | undefined): string {
	return amount !== undefined ? formatUsd(amount) : MISSING_AMOUNT;
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

	return `${formatUsdOrDash(usage.totalSpent)} used · ${formatUsdOrDash(usage.remaining)} left`;
}

/**
 * Period spend for the settings card.
 * A missing figure is an em dash, e.g. `$0.12 today · — this week · $3.58 this month`.
 */
export function formatPlanUsagePeriodLine(
	usage: AIProviderPlanUsage | null | undefined,
): string | null {
	if (!usage?.supported || usage.unavailableReason) {
		return null;
	}

	return [
		`${formatUsdOrDash(usage.spentDaily)} today`,
		`${formatUsdOrDash(usage.spentWeekly)} this week`,
		`${formatUsdOrDash(usage.spentMonthly)} this month`,
	].join(" · ");
}

/** Attach numeric period spend and matching `$X.XX` labels. */
export function periodUsageFields(input: {
	daily?: number;
	weekly?: number;
	monthly?: number;
}): Pick<
	AIProviderPlanUsage,
	| "spentDaily"
	| "spentWeekly"
	| "spentMonthly"
	| "spentDailyLabel"
	| "spentWeeklyLabel"
	| "spentMonthlyLabel"
> {
	return {
		...(input.daily !== undefined
			? { spentDaily: input.daily, spentDailyLabel: formatUsd(input.daily) }
			: {}),
		...(input.weekly !== undefined
			? {
					spentWeekly: input.weekly,
					spentWeeklyLabel: formatUsd(input.weekly),
				}
			: {}),
		...(input.monthly !== undefined
			? {
					spentMonthly: input.monthly,
					spentMonthlyLabel: formatUsd(input.monthly),
				}
			: {}),
	};
}

/** Human-readable summary for settings UI, e.g. `$4.50 used · $95.50 left` or `N/A`. */
export function formatPlanUsageSummary(
	usage: AIProviderPlanUsage | null | undefined,
): string {
	if (!usage?.supported || usage.unavailableReason) {
		return "N/A";
	}

	return `${formatUsdOrDash(usage.totalSpent)} used · ${formatUsdOrDash(usage.remaining)} left`;
}
