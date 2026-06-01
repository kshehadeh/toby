import { describe, expect, it } from "vitest";
import { shouldGeneratePlan } from "../src/planning/plan-generator";

describe("shouldGeneratePlan", () => {
	it("returns false when TOBY_DISABLE_PLANNING is set", () => {
		const orig = process.env.TOBY_DISABLE_PLANNING;
		process.env.TOBY_DISABLE_PLANNING = "1";
		expect(shouldGeneratePlan(null, "first do X and then do Y")).toBe(false);
		process.env.TOBY_DISABLE_PLANNING = orig;
	});

	it("returns true when spec has 2+ mustDo items", () => {
		expect(
			shouldGeneratePlan(
				{
					goal: "test",
					mustDo: ["step 1", "step 2"],
					mustNotDo: [],
					assumptions: [],
					openQuestions: [],
					relevantIntegrations: [],
					relevantSkills: [],
				},
				"do stuff",
			),
		).toBe(true);
	});

	it("returns true for 'and then' pattern", () => {
		expect(
			shouldGeneratePlan(null, "fetch emails and then categorize them"),
		).toBe(true);
	});

	it("returns false for simple single-step requests", () => {
		expect(shouldGeneratePlan(null, "show me my unread emails")).toBe(false);
	});

	it("returns true for data gathering plus processing requests", () => {
		expect(shouldGeneratePlan(null, "summarize today's emails")).toBe(true);
	});

	it("returns false when spec has only 1 mustDo item", () => {
		expect(
			shouldGeneratePlan(
				{
					goal: "test",
					mustDo: ["only one thing"],
					mustNotDo: [],
					assumptions: [],
					openQuestions: [],
					relevantIntegrations: [],
					relevantSkills: [],
				},
				"do one thing",
			),
		).toBe(false);
	});
});
