/** Normalized plan/billing usage for an AI provider (USD credits or spend). */
export type AIProviderPlanUsage = {
	readonly providerId: string;
	readonly supported: boolean;
	readonly currency?: "USD";
	/** Lifetime spend (Vercel `total_used`, OpenRouter `usage`). */
	readonly totalSpent?: number;
	/** Remaining balance (Vercel `balance`, OpenRouter `limit_remaining`). */
	readonly remaining?: number;
	readonly unavailableReason?: string;
	/** Display-formatted total spent (e.g. "$4.50" or "N/A"). */
	readonly totalSpentLabel?: string;
	/** Display-formatted remaining balance (e.g. "$95.50" or "N/A"). */
	readonly remainingLabel?: string;
	/** Spend in the current UTC day, when the provider reports it. */
	readonly spentDaily?: number;
	/** Spend in the current UTC week (Monday–Sunday), when reported. */
	readonly spentWeekly?: number;
	/** Spend in the current UTC month, when reported. */
	readonly spentMonthly?: number;
	readonly spentDailyLabel?: string;
	readonly spentWeeklyLabel?: string;
	readonly spentMonthlyLabel?: string;
	readonly fetchedAt: string;
};

/** Per AI provider: fetch plan usage from provider billing APIs. */
export interface PlanUsageAdapter {
	readonly providerId: string;
	fetchPlanUsage(): Promise<AIProviderPlanUsage>;
}
