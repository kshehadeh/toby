import {
	addTurnToSessionTokenTotals,
	emptySessionTokenTotals,
	extractTokenUsageReport,
} from "@toby/core/ai/caching";
import { describe, expect, it } from "bun:test";
import { buildUsageSections } from "../src/ui/chat/usage-sections";

describe("session token totals", () => {
	it("accumulates turn token reports", () => {
		const report = extractTokenUsageReport(
			{
				inputTokens: 100,
				outputTokens: 25,
				totalTokens: 125,
				inputTokenDetails: { cacheReadTokens: 40 },
			},
			{
				persona: {
					name: "Toby",
					instructions: "",
					promptMode: "add",
					ai: { provider: "openai", model: "gpt-5-mini" },
				},
			},
		);
		const totals = addTurnToSessionTokenTotals(
			emptySessionTokenTotals(),
			report,
		);
		expect(totals.turnCount).toBe(1);
		expect(totals.inputTokens).toBe(100);
		expect(totals.outputTokens).toBe(25);
		expect(totals.cacheReadTokens).toBe(40);
	});
});

describe("buildUsageSections", () => {
	const persona = {
		name: "Toby",
		instructions: "",
		promptMode: "add" as const,
		ai: { provider: "vercel", model: "openai/gpt-5-mini" },
	};

	it("includes provider plan and session sections", () => {
		const sections = buildUsageSections({
			persona,
			sessionName: "Morning planning",
			sessionTokenTotals: {
				turnCount: 2,
				inputTokens: 500,
				outputTokens: 120,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
			lastUsage: {
				inputTokens: 250,
				outputTokens: 60,
				totalTokens: 310,
			},
			planUsage: {
				providerId: "vercel",
				supported: true,
				currency: "USD",
				totalSpent: 4.5,
				remaining: 95.5,
				fetchedAt: "2026-06-07T12:00:00.000Z",
			},
			planUsageLoading: false,
		});

		expect(sections.providerPlan.some((row) => row.label === "Remaining")).toBe(
			true,
		);
		expect(
			sections.activeSession.some((row) => row.keys === "Morning planning"),
		).toBe(true);
		expect(sections.lastTurn.some((row) => row.label === "Input")).toBe(true);
		expect(sections.notes.length).toBeGreaterThan(0);
	});

	it("shows loading state for provider plan usage", () => {
		const sections = buildUsageSections({
			persona,
			sessionName: "New chat",
			sessionTokenTotals: emptySessionTokenTotals(),
			lastUsage: null,
			planUsage: null,
			planUsageLoading: true,
		});

		expect(sections.providerPlan.some((row) => row.keys === "Loading…")).toBe(
			true,
		);
	});
});
