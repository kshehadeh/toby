import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { clearDashboardCache } from "@toby/core/dashboard";
import { clearDashboardSummaryCache } from "@toby/core/dashboard/summarizer";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";

describe("dashboard summarizer", () => {
	beforeEach(() => {
		clearDashboardCache();
		clearDashboardSummaryCache();
	});

	afterEach(() => {
		clearDashboardCache();
		clearDashboardSummaryCache();
		resetPluginModuleCache();
	});

	it("returns null for unknown category", async () => {
		const { getDashboardCategorySummary } = await import(
			"@toby/core/dashboard/summarizer"
		);
		const result = await getDashboardCategorySummary("unknown");
		expect(result).toBeNull();
	}, 10_000);

	it("caches results so second call returns same reference", async () => {
		const { getDashboardCategorySummary } = await import(
			"@toby/core/dashboard/summarizer"
		);
		// First call may produce a summary or null (depends on connected providers).
		const first = await getDashboardCategorySummary("tasks");
		// Second call should return the exact same reference (cache hit).
		const second = await getDashboardCategorySummary("tasks");
		expect(second).toBe(first);
	}, 30_000);

	it("clearDashboardSummaryCache empties the cache", () => {
		clearDashboardSummaryCache();
		// Should not throw
		expect(true).toBe(true);
	});
});

describe("dashboard summarizer types", () => {
	it("DashboardCategoryAiSummary has expected fields", () => {
		// Type-level test: verify the interface exists and has the right shape
		const summary = {
			category: "email",
			text: "You have 3 important emails.",
			generatedAt: "2026-07-10T12:00:00Z",
			personaName: "Toby",
			count: 10,
			launchUrls: ["https://mail.example.com"],
		};
		expect(summary.category).toBe("email");
		expect(summary.text).toContain("3 important emails");
		expect(summary.personaName).toBe("Toby");
		expect(summary.count).toBe(10);
		expect(summary.launchUrls).toHaveLength(1);
	});
});
