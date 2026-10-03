import { resolveOpenRouterAuthToken } from "../credentials";
import { periodUsageFields } from "../format";
import type { AIProviderPlanUsage, PlanUsageAdapter } from "../types";

/** Current-key credit limit. @see https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key */
const KEY_INFO_URL = "https://openrouter.ai/api/v1/key";

function parseUsdAmount(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function formatUsd(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

export const openRouterPlanUsageAdapter: PlanUsageAdapter = {
	providerId: "openrouter",

	async fetchPlanUsage(): Promise<AIProviderPlanUsage> {
		const fetchedAt = new Date().toISOString();
		const token = resolveOpenRouterAuthToken();
		if (!token) {
			return {
				providerId: "openrouter",
				supported: true,
				unavailableReason:
					"OpenRouter API key not configured. Run `toby configure` to set it, or set OPENROUTER_API_KEY.",
				totalSpentLabel: "N/A",
				remainingLabel: "N/A",
				fetchedAt,
			};
		}

		let response: Response;
		try {
			response = await fetch(KEY_INFO_URL, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
			});
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return {
				providerId: "openrouter",
				supported: true,
				unavailableReason: `Failed to reach OpenRouter key API: ${msg}`,
				totalSpentLabel: "N/A",
				remainingLabel: "N/A",
				fetchedAt,
			};
		}

		if (!response.ok) {
			let detail = response.statusText;
			try {
				const body = (await response.json()) as {
					error?: { message?: string };
				};
				if (body.error?.message) {
					detail = body.error.message;
				}
			} catch {
				// ignore parse errors
			}
			return {
				providerId: "openrouter",
				supported: true,
				unavailableReason: `OpenRouter key API returned ${response.status}: ${detail}`,
				totalSpentLabel: "N/A",
				remainingLabel: "N/A",
				fetchedAt,
			};
		}

		const body = (await response.json()) as {
			data?: {
				limit_remaining?: unknown;
				usage?: unknown;
				usage_daily?: unknown;
				usage_weekly?: unknown;
				usage_monthly?: unknown;
			};
		};

		// `limit_remaining` is the key's spending cap left. Null means the key
		// has no cap, so remaining is omitted and only lifetime usage is shown.
		// Period fields are current UTC day, week (Monday start), and month.
		const remaining = parseUsdAmount(body.data?.limit_remaining);
		const totalSpent = parseUsdAmount(body.data?.usage);

		return {
			providerId: "openrouter",
			supported: true,
			currency: "USD",
			remaining,
			totalSpent,
			totalSpentLabel: totalSpent !== undefined ? formatUsd(totalSpent) : "N/A",
			remainingLabel: remaining !== undefined ? formatUsd(remaining) : "N/A",
			...periodUsageFields({
				daily: parseUsdAmount(body.data?.usage_daily),
				weekly: parseUsdAmount(body.data?.usage_weekly),
				monthly: parseUsdAmount(body.data?.usage_monthly),
			}),
			fetchedAt,
		};
	},
};
