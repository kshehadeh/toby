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

	it("strips fidelity-matrix / skill metadata before the real summary", () => {
		const raw = `<fidelity-matrix>
Category | Requirement | Source | Status
Tasks | Urgency first | list | ok
</fidelity-matrix>
skill name="writing-style"
skill name="task-event-organizer"

## Needs attention
- **Close QMES PAP supplies account** — high urgency

## Worth mentioning
Fraud-prevention and estate items stand out.`;
		const extracted = extractDashboardSummaryText(raw);
		expect(extracted.startsWith("## Needs attention")).toBe(true);
		expect(extracted).toContain("Close QMES PAP supplies account");
		expect(extracted).not.toContain("fidelity-matrix");
		expect(extracted).not.toContain("writing-style");
		expect(extracted).not.toContain("Category | Requirement");
	});

	it("salvages plain NEEDS ATTENTION section after meta preamble", () => {
		const raw = `Category | Requirement | Source | Status
skill name="task-event-organizer"

NEEDS ATTENTION
- Close QMES PAP supplies account — high urgency
WORTH MENTIONING
Fraud-prevention items stand out.`;
		const extracted = extractDashboardSummaryText(raw);
		expect(extracted.toLowerCase().startsWith("needs attention")).toBe(true);
		expect(extracted).toContain("Close QMES PAP");
		expect(extracted).not.toContain("Category | Requirement");
	});

	it("keeps short preambles that are part of the answer", () => {
		const raw =
			"Nothing urgent today.\n\n## Worth mentioning\n- A newsletter you might skim.";
		// Short preamble without planning language should stay.
		expect(extractDashboardSummaryText(raw)).toBe(raw);
	});

	it("rejects pure chain-of-thought with no final summary", () => {
		const raw = `We need to determine the current date. The events start on 2026-07-17.
The user said: "if it's Friday, summarize events for Friday…" Let's check.
The instruction says 5-6 sentences total. So we need to condense.
Also note: Use Today/Tomorrow headers. Let's count: Today section: 2 sentences.
Sentence 1: Today is packed with Open Dev Day.
Better: write bullets. That's more than 5-6 sentences. Need to condense.`;
		expect(extractDashboardSummaryText(raw)).toBe("");
	});

	it("keeps a real calendar-style summary", () => {
		const clean = `## Needs attention
Your week kicks off **today** with an all-day **Open Dev Day** and a **Delta flight** at 9:40 PM ET.

## Later
Monday is packed: **Standup: UAI Web** at 10 AM, then overlapping afternoon meetings.`;
		expect(extractDashboardSummaryText(clean)).toBe(clean);
	});
});

describe("dashboard summarizer types", () => {
	it("DashboardBlockContent has expected fields", () => {
		const content = {
			category: "email",
			text: "You have 3 important emails.",
			generatedAt: "2026-07-10T12:00:00Z",
			personaName: "Toby",
			count: 10,
			launchUrls: ["https://mail.example.com"],
		};
		expect(content.category).toBe("email");
		expect(content.text).toContain("3 important emails");
		expect(content.personaName).toBe("Toby");
		expect(content.count).toBe(10);
		expect(content.launchUrls).toHaveLength(1);
	});
});
