import { openAiPlanUsageAdapter } from "@toby/core/ai/plan-usage/adapters/openai";
import { vercelGatewayPlanUsageAdapter } from "@toby/core/ai/plan-usage/adapters/vercel-gateway";
import {
	clearPlanUsageCache,
	fetchAIProviderPlanUsage,
} from "@toby/core/ai/plan-usage/fetch";
import { formatPlanUsageStatusLine } from "@toby/core/ai/plan-usage/format";
import { afterEach, describe, expect, it, mock } from "bun:test";

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
			delete process.env.AI_GATEWAY_API_KEY;
		}
		originalEnv = undefined;
	}
});

describe("plan usage adapters", () => {
	it("reports OpenAI plan usage as unsupported", async () => {
		const usage = await openAiPlanUsageAdapter.fetchPlanUsage();
		expect(usage.supported).toBe(false);
		expect(usage.unavailableReason).toContain("OpenAI");
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
		expect(formatPlanUsageStatusLine(usage)).toBe("$4.50 used \u00b7 $95.50 left");
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
});
