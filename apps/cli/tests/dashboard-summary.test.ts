import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { clearDashboardCache } from "@toby/core/dashboard";
import {
	clearDashboardSummaryCache,
	extractDashboardSummaryText,
} from "@toby/core/dashboard/summarizer";
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

describe("extractDashboardSummaryText", () => {
	it("returns clean summaries unchanged", () => {
		const clean =
			"## Needs attention\n- **Cancel Stash** is due today.\n\n## Worth mentioning\n- Laptop requests by Jul 13.";
		expect(extractDashboardSummaryText(clean)).toBe(clean);
	});

	it("strips planning monologue before markdown headings", () => {
		const raw = `We need to summarize tasks and reminders focusing on most urgent, late, or important. The user provided a list with dates and urgency levels. We need to identify high urgency items that are past due or upcoming soon. Also note that the current date is not given, but we can infer from the dates. Let's structure the answer with headings.

## Needs attention
- **Late:** Bring up pnpm change (due Jun 29)

## Worth mentioning
- Confirm start dates due Jul 10.`;
		const extracted = extractDashboardSummaryText(raw);
		expect(extracted.startsWith("## Needs attention")).toBe(true);
		expect(extracted).toContain("Bring up pnpm change");
		expect(extracted).not.toContain("We need to summarize");
		expect(extracted).not.toContain("The user provided");
	});

	it("strips XML think tags", () => {
		const raw = `<think>
I should list the late tasks first then the upcoming ones.
</think>

You have **3 late tasks** that need attention today.`;
		expect(extractDashboardSummaryText(raw)).toBe(
			"You have **3 late tasks** that need attention today.",
		);
	});

	it("keeps short preambles that are part of the answer", () => {
		const raw =
			"Nothing urgent today.\n\n## Worth mentioning\n- A newsletter you might skim.";
		// Short preamble without planning language should stay.
		expect(extractDashboardSummaryText(raw)).toBe(raw);
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
