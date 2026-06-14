import { resolveVercelGatewayAuthToken } from "../credentials";
import type { AIProviderPlanUsage, PlanUsageAdapter } from "../types";

const CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";

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

export const vercelGatewayPlanUsageAdapter: PlanUsageAdapter = {
	providerId: "vercel",

	async fetchPlanUsage(): Promise<AIProviderPlanUsage> {
		const fetchedAt = new Date().toISOString();
		const token = resolveVercelGatewayAuthToken();
		if (!token) {
			return {
				providerId: "vercel",
				supported: true,
				unavailableReason:
					"Vercel AI Gateway API key not configured. Run `toby configure` to set it, or set AI_GATEWAY_API_KEY.",
				fetchedAt,
			};
		}

		let response: Response;
		try {
			response = await fetch(CREDITS_URL, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
			});
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return {
				providerId: "vercel",
				supported: true,
				unavailableReason: `Failed to reach Vercel AI Gateway credits API: ${msg}`,
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
				providerId: "vercel",
				supported: true,
				unavailableReason: `Vercel AI Gateway credits API returned ${response.status}: ${detail}`,
				fetchedAt,
			};
		}

		const body = (await response.json()) as {
			balance?: unknown;
			total_used?: unknown;
		};

		return {
			providerId: "vercel",
			supported: true,
			currency: "USD",
			remaining: parseUsdAmount(body.balance),
			totalSpent: parseUsdAmount(body.total_used),
			fetchedAt,
		};
	},
};
