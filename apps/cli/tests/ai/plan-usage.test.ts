import { afterEach, describe, expect, it, mock } from "bun:test";
import { openAiPlanUsageAdapter } from "@toby/core/ai/plan-usage/adapters/openai";
import { vercelGatewayPlanUsageAdapter } from "@toby/core/ai/plan-usage/adapters/vercel-gateway";
import {
	clearPlanUsageCache,
	fetchAIProviderPlanUsage,
	fetchAllAIProviderPlanUsage,
} from "@toby/core/ai/plan-usage/fetch";
import {
	formatPlanUsageStatusLine,
	formatPlanUsageSummary,
} from "@toby/core/ai/plan-usage/format";

let originalFetch: typeof globalThis.fetch;
let originalEnv: string | undefined;

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
});

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

		expect(fetchMock).toHaveBeenCalledTimes(1);
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
