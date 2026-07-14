/** Normalized plan/billing usage for an AI provider (USD credits or spend). */
export type AIProviderPlanUsage = {
	readonly providerId: string;
	readonly supported: boolean;
	readonly currency?: "USD";
	/** Lifetime or provider-reported total spend (e.g. Vercel `total_used`). */
	readonly totalSpent?: number;
	/** Remaining balance (e.g. Vercel `balance`). */
	readonly remaining?: number;
	readonly unavailableReason?: string;
	/** Display-formatted total spent (e.g. "$4.50" or "N/A"). */
	readonly totalSpentLabel?: string;
	/** Display-formatted remaining balance (e.g. "$95.50" or "N/A"). */
	readonly remainingLabel?: string;
	readonly fetchedAt: string;
};

/** Per AI provider: fetch plan usage from provider billing APIs. */
export interface PlanUsageAdapter {
	readonly providerId: string;
	fetchPlanUsage(): Promise<AIProviderPlanUsage>;
}
