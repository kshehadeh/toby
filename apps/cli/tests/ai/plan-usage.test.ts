import { afterEach, describe, expect, it, mock } from "bun:test";
import { openAiPlanUsageAdapter } from "@toby/core/ai/plan-usage/adapters/openai";
import { openRouterPlanUsageAdapter } from "@toby/core/ai/plan-usage/adapters/openrouter";
import {
	gatewayReportWindow,
	sumGatewaySpendByPeriod,
	utcWeekStartMonday,
	vercelGatewayPlanUsageAdapter,
} from "@toby/core/ai/plan-usage/adapters/vercel-gateway";
import {
	clearPlanUsageCache,
	fetchAIProviderPlanUsage,
	fetchAllAIProviderPlanUsage,
} from "@toby/core/ai/plan-usage/fetch";
import {
	formatPlanUsagePeriodLine,
	formatPlanUsageStatusLine,
	formatPlanUsageSummary,
} from "@toby/core/ai/plan-usage/format";

let originalFetch: typeof globalThis.fetch;
let originalEnv: string | undefined;
let originalOpenRouterEnv: string | undefined;
let openRouterEnvCaptured = false;

afterEach(() => {
	if (originalFetch) {
		globalThis.fetch = originalFetch;
		originalFetch = undefined;
	}
	if (originalEnv !== undefined) {
		if (originalEnv) {
			process.env.AI_GATEWAY_API_KEY = originalEnv;
		} else {
			process.env.AI_GATEWAY_API_KEY = undefined;
		}
		originalEnv = undefined;
	}
	if (openRouterEnvCaptured) {
		if (originalOpenRouterEnv) {
			process.env.OPENROUTER_API_KEY = originalOpenRouterEnv;
		} else {
			process.env.OPENROUTER_API_KEY = undefined;
		}
		originalOpenRouterEnv = undefined;
		openRouterEnvCaptured = false;
	}
});

function useOpenRouterTestKey(): void {
	if (!openRouterEnvCaptured) {
		originalOpenRouterEnv = process.env.OPENROUTER_API_KEY;
		openRouterEnvCaptured = true;
	}
	process.env.OPENROUTER_API_KEY = "sk-or-test";
}

describe("plan usage adapters", () => {
	it("reports OpenAI plan usage as unsupported", async () => {
		const usage = await openAiPlanUsageAdapter.fetchPlanUsage();
		expect(usage.supported).toBe(false);
		expect(usage.unavailableReason).toContain("OpenAI");
		expect(usage.totalSpentLabel).toBe("N/A");
		expect(usage.remainingLabel).toBe("N/A");
	});

	it("parses Vercel gateway credits response", async () => {
		originalFetch = globalThis.fetch;
		const fetchMock = mock().mockResolvedValue(
			new Response(JSON.stringify({ balance: "95.50", total_used: "4.50" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		globalThis.fetch = fetchMock as typeof globalThis.fetch;
		originalEnv = process.env.AI_GATEWAY_API_KEY;
		process.env.AI_GATEWAY_API_KEY = "test-key";

		const usage = await vercelGatewayPlanUsageAdapter.fetchPlanUsage();
		expect(usage.supported).toBe(true);
		expect(usage.remaining).toBe(95.5);
		expect(usage.totalSpent).toBe(4.5);
		expect(usage.totalSpentLabel).toBe("$4.50");
		expect(usage.remainingLabel).toBe("$95.50");
		expect(formatPlanUsageStatusLine(usage)).toBe(
			"$4.50 used \u00b7 $95.50 left",
		);
	});

	it("parses OpenRouter key limit response", async () => {
		originalFetch = globalThis.fetch;
		const fetchMock = mock().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: {
						usage: 1.25,
						limit_remaining: 8.75,
						limit: 10,
						usage_daily: 0.12,
						usage_weekly: 0.87,
						usage_monthly: 3.58,
					},
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			),
		);
		globalThis.fetch = fetchMock as typeof globalThis.fetch;
		useOpenRouterTestKey();

		const usage = await openRouterPlanUsageAdapter.fetchPlanUsage();
		expect(usage.supported).toBe(true);
		expect(usage.remaining).toBe(8.75);
		expect(usage.totalSpent).toBe(1.25);
		expect(usage.totalSpentLabel).toBe("$1.25");
		expect(usage.remainingLabel).toBe("$8.75");
		expect(usage.spentDaily).toBe(0.12);
		expect(usage.spentWeekly).toBe(0.87);
		expect(usage.spentMonthly).toBe(3.58);
		expect(usage.spentDailyLabel).toBe("$0.12");
		expect(formatPlanUsageStatusLine(usage)).toBe(
			"$1.25 used \u00b7 $8.75 left",
		);
		expect(formatPlanUsagePeriodLine(usage)).toBe(
			"$0.12 today \u00b7 $0.87 this week \u00b7 $3.58 this month",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://openrouter.ai/api/v1/key",
		);
	});

	it("omits remaining when an OpenRouter key has no spending cap", async () => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = mock().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: { usage: 3.5, limit: null, limit_remaining: null },
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			),
		) as typeof globalThis.fetch;
		useOpenRouterTestKey();

		const usage = await openRouterPlanUsageAdapter.fetchPlanUsage();
		expect(usage.supported).toBe(true);
		expect(usage.remaining).toBeUndefined();
		expect(usage.remainingLabel).toBe("N/A");
		expect(usage.totalSpent).toBe(3.5);
		expect(formatPlanUsageStatusLine(usage)).toBe(
			"$3.50 used \u00b7 \u2014 left",
		);
		expect(formatPlanUsagePeriodLine(usage)).toBe(
			"\u2014 today \u00b7 \u2014 this week \u00b7 \u2014 this month",
		);
	});

	it("sums Vercel spend for today, this week, and this month", () => {
		expect(utcWeekStartMonday("2026-09-06")).toBe("2026-08-31");
		expect(gatewayReportWindow("2026-09-02")).toEqual({
			start: "2026-08-31",
			end: "2026-09-02",
		});
		expect(gatewayReportWindow("2026-09-22")).toEqual({
			start: "2026-09-01",
			end: "2026-09-22",
		});
		expect(
			sumGatewaySpendByPeriod(
				[
					{ day: "2026-08-31", total_cost: 1 },
					{ day: "2026-09-01", total_cost: 2 },
					{ day: "2026-09-02", total_cost: 0.25 },
				],
				"2026-09-02",
			),
		).toEqual({ daily: 0.25, weekly: 3.25, monthly: 2.25 });
		expect(
			sumGatewaySpendByPeriod(
				[{ day: "2026-09-01", total_cost: 2 }],
				"2026-09-22",
			),
		).toEqual({
			daily: undefined,
			weekly: undefined,
			monthly: 2,
		});
		expect(
			sumGatewaySpendByPeriod(
				[{ day: "2026-09-22", total_cost: 0 }],
				"2026-09-22",
			),
		).toEqual({ daily: 0, weekly: 0, monthly: 0 });
	});

	it("parses Vercel period spend from the report API", async () => {
		const today = new Date().toISOString().slice(0, 10);
		const window = gatewayReportWindow(today);
		const rows = [
			{ day: today, total_cost: 0.4 },
			...(window.start === today
				? []
				: [{ day: window.start, total_cost: 1.1 }]),
		];
		const expected = sumGatewaySpendByPeriod(rows, today);

		originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/v1/report")) {
				expect(url).toContain(`start_date=${window.start}`);
				expect(url).toContain(`end_date=${today}`);
				expect(url).toContain("group_by=day");
				return new Response(JSON.stringify({ results: rows }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response(
				JSON.stringify({ balance: "95.50", total_used: "4.50" }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof globalThis.fetch;
		originalEnv = process.env.AI_GATEWAY_API_KEY;
		process.env.AI_GATEWAY_API_KEY = "test-key";

		const usage = await vercelGatewayPlanUsageAdapter.fetchPlanUsage();
		expect(usage.remaining).toBe(95.5);
		expect(usage.totalSpent).toBe(4.5);
		expect(usage.spentDaily).toBe(expected.daily);
		expect(usage.spentWeekly).toBe(expected.weekly);
		expect(usage.spentMonthly).toBe(expected.monthly);
		expect(formatPlanUsagePeriodLine(usage)).toContain("today");
	});

	it("keeps Vercel balance when the spend report is unavailable", async () => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/v1/report")) {
				return new Response(
					JSON.stringify({ error: { message: "Hobby plan" } }),
					{ status: 403 },
				);
			}
			return new Response(
				JSON.stringify({ balance: "95.50", total_used: "4.50" }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof globalThis.fetch;
		originalEnv = process.env.AI_GATEWAY_API_KEY;
		process.env.AI_GATEWAY_API_KEY = "test-key";

		const usage = await vercelGatewayPlanUsageAdapter.fetchPlanUsage();
		expect(usage.remaining).toBe(95.5);
		expect(usage.totalSpent).toBe(4.5);
		expect(usage.spentDaily).toBeUndefined();
		expect(usage.unavailableReason).toBeUndefined();
		expect(formatPlanUsagePeriodLine(usage)).toBe(
			"\u2014 today \u00b7 \u2014 this week \u00b7 \u2014 this month",
		);
		expect(formatPlanUsageStatusLine(usage)).toBe(
			"$4.50 used \u00b7 $95.50 left",
		);
	});

	it("caches provider plan usage fetches", async () => {
		clearPlanUsageCache();
		originalFetch = globalThis.fetch;
		const fetchMock = mock().mockResolvedValue(
			new Response(JSON.stringify({ balance: "10.00", total_used: "1.00" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		globalThis.fetch = fetchMock as typeof globalThis.fetch;
		originalEnv = process.env.AI_GATEWAY_API_KEY;
		process.env.AI_GATEWAY_API_KEY = "test-key";

		await fetchAIProviderPlanUsage("vercel");
		await fetchAIProviderPlanUsage("vercel");

		// Credits plus one spend report, then the second provider fetch is cached.
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("returns N/A for known providers without adapters", async () => {
		clearPlanUsageCache();
		const usage = await fetchAIProviderPlanUsage("ollama");
		expect(usage.supported).toBe(false);
		expect(usage.totalSpentLabel).toBe("N/A");
		expect(usage.remainingLabel).toBe("N/A");
		expect(usage.unavailableReason).toContain("Ollama");
	});

	it("returns N/A for unknown providers", async () => {
		clearPlanUsageCache();
		const usage = await fetchAIProviderPlanUsage("nonexistent");
		expect(usage.supported).toBe(false);
		expect(usage.totalSpentLabel).toBe("N/A");
		expect(usage.remainingLabel).toBe("N/A");
	});

	it("formatPlanUsageSummary returns N/A for unsupported", () => {
		expect(formatPlanUsageSummary(null)).toBe("N/A");
		expect(
			formatPlanUsageSummary({
				providerId: "test",
				supported: false,
				totalSpentLabel: "N/A",
				remainingLabel: "N/A",
				fetchedAt: new Date().toISOString(),
			}),
		).toBe("N/A");
	});

	it("formatPlanUsageSummary returns formatted string for supported", () => {
		expect(
			formatPlanUsageSummary({
				providerId: "vercel",
				supported: true,
				currency: "USD",
				totalSpent: 4.5,
				remaining: 95.5,
				totalSpentLabel: "$4.50",
				remainingLabel: "$95.50",
				fetchedAt: new Date().toISOString(),
			}),
		).toBe("$4.50 used \u00b7 $95.50 left");
	});

	it("fetchAllAIProviderPlanUsage returns usage for every registered provider", async () => {
		clearPlanUsageCache();
		const all = await fetchAllAIProviderPlanUsage();
		expect(all.length).toBeGreaterThanOrEqual(5);
		const ids = all.map((u) => u.providerId);
		expect(ids).toContain("openai");
		expect(ids).toContain("vercel");
		expect(ids).toContain("ollama");
		expect(ids).toContain("chutes");
		expect(ids).toContain("openrouter");
		// Every entry should have display labels
		for (const u of all) {
			expect(u.totalSpentLabel).toBeDefined();
			expect(u.remainingLabel).toBeDefined();
		}
	});
});
