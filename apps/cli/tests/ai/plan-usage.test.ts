import { describe, expect, it, vi } from "vitest";
import { fetchAIProviderPlanUsage, clearPlanUsageCache } from "@toby/core/ai/plan-usage/fetch";
import { openAiPlanUsageAdapter } from "@toby/core/ai/plan-usage/adapters/openai";
import { vercelGatewayPlanUsageAdapter } from "@toby/core/ai/plan-usage/adapters/vercel-gateway";
import { formatPlanUsageStatusLine } from "@toby/core/ai/plan-usage/format";

describe("plan usage adapters", () => {
	it("reports OpenAI plan usage as unsupported", async () => {
		const usage = await openAiPlanUsageAdapter.fetchPlanUsage();
		expect(usage.supported).toBe(false);
		expect(usage.unavailableReason).toContain("OpenAI");
	});

	it("parses Vercel gateway credits response", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ balance: "95.50", total_used: "4.50" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

		const usage = await vercelGatewayPlanUsageAdapter.fetchPlanUsage();
		expect(usage.supported).toBe(true);
		expect(usage.remaining).toBe(95.5);
		expect(usage.totalSpent).toBe(4.5);
		expect(formatPlanUsageStatusLine(usage)).toBe(
			"$4.50 used · $95.50 left",
		);

		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("caches provider plan usage fetches", async () => {
		clearPlanUsageCache();
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ balance: "10.00", total_used: "1.00" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");

		await fetchAIProviderPlanUsage("vercel");
		await fetchAIProviderPlanUsage("vercel");

		expect(fetchMock).toHaveBeenCalledTimes(1);

		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});
});
