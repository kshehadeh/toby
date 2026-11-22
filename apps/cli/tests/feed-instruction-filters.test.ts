import { beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import type { FeedRuleFilter } from "@toby/core/feed/instruction-filters";

/** Count ranking runs; every candidate comes back ranked. */
let runs = 0;
mock.module("@toby/core/flows/runner", () => ({
	runFlow: async () => ({ ok: false, error: "unused", outputs: {} }),
	runFlowDefinition: async (_def: unknown, opts: { inputs?: unknown }) => {
		runs += 1;
		const candidates =
			(opts.inputs as { candidates?: unknown[] } | undefined)?.candidates ?? [];
		return {
			ok: true,
			outputs: {
				ranking: {
					items: candidates.map((_, i) => ({
						key: `c${i + 1}`,
						tier: "today",
						priority: 50,
						reason: "Due soon.",
						actions: ["task.help"],
					})),
				},
			},
		};
	},
}));

const { clearFeedCache, getFeedContent } = await import(
	"@toby/core/feed/index"
);
const {
	activeRuleFilters,
	applyRuleFilters,
	compileInstructionRule,
	filterMatches,
	instructionRuleHash,
	ruleContextFrom,
} = await import("@toby/core/feed/instruction-filters");
const { instructionEnforcement } = await import(
	"@toby/core/web/handlers/dashboard"
);
const { createTodo } = await import("@toby/core/todos/service");
const { getDashboardFeedPath, getDashboardFeedStatePath } = await import(
	"@toby/core/config/index"
);
const { addInstruction, clearFeedStateCache, loadFeedState, updateFeedState } =
	await import("@toby/core/feed/state");

const eligible = async () =>
	({
		ok: true,
		ref: { provider: "openrouter", model: "openai/gpt-5-mini" },
		source: "config",
	}) as const;

/** "You can ignore anything from Todoist that is not in the Inbox" */
const outsideInbox: FeedRuleFilter = {
	categories: ["tasks"],
	providers: ["todoist"],
	listMode: "not_in",
	lists: ["Inbox"],
	assignmentMode: "any",
	assignments: [],
};
/** "Ignore anything that is not assigned to me" */
const notMine: FeedRuleFilter = {
	categories: [],
	providers: [],
	listMode: "any",
	lists: [],
	assignmentMode: "not_in",
	assignments: ["you"],
};

function task(
	subtitle: string,
	assignment?: "you" | "someone_else" | "unassigned",
) {
	return {
		category: "tasks" as const,
		providerName: "todoist",
		providerDisplayName: "Todoist",
		subtitle,
		...(assignment ? { task: { assignment, shared: true as const } } : {}),
	};
}

describe("Feed instruction filters", () => {
	it("hides Todoist tasks outside the Inbox and nothing else", () => {
		expect(filterMatches(outsideInbox, task("Financial"))).toBe(true);
		expect(filterMatches(outsideInbox, task("Trust Taxes"))).toBe(true);
		expect(filterMatches(outsideInbox, task("inbox"))).toBe(false);
		expect(
			filterMatches(outsideInbox, {
				...task("Personal"),
				providerName: "applereminders",
				providerDisplayName: "Reminders",
			}),
		).toBe(false);
		expect(
			filterMatches(outsideInbox, {
				category: "calendar",
				providerName: "applecalendar",
				subtitle: "Personal",
			}),
		).toBe(false);
	});

	it("hides tasks assigned to others but keeps items with no assignment facts", () => {
		expect(filterMatches(notMine, task("Shared", "someone_else"))).toBe(true);
		expect(filterMatches(notMine, task("Shared", "unassigned"))).toBe(true);
		expect(filterMatches(notMine, task("Shared", "you"))).toBe(false);
		// Personal projects send no facts: the user's own.
		expect(filterMatches(notMine, task("Financial"))).toBe(false);
		expect(
			filterMatches(notMine, { category: "email", providerName: "email" }),
		).toBe(false);
	});

	it("never applies a filter that names nothing", () => {
		const empty: FeedRuleFilter = {
			categories: [],
			providers: [],
			listMode: "not_in",
			lists: [],
			assignmentMode: "any",
			assignments: [],
		};
		expect(filterMatches(empty, task("Financial"))).toBe(false);
		expect(
			applyRuleFilters([task("Inbox"), task("Financial")], [empty]),
		).toHaveLength(2);
	});

	it("compiles to filter, guidance, or a retryable failure, keyed to the text", async () => {
		const now = new Date("2026-11-22T12:00:00Z");
		const instruction = {
			id: "a",
			text: "Ignore Todoist outside the Inbox",
			createdAt: now.toISOString(),
			enabled: true,
		};
		const context = ruleContextFrom([task("Inbox"), task("Financial")]);
		expect(context.providers[0]?.lists).toEqual(["Financial", "Inbox"]);

		const filter = await compileInstructionRule(
			instruction,
			context,
			async () => ({
				filters: [outsideInbox],
				summary: "Hides Todoist tasks outside the Inbox",
			}),
			now,
		);
		expect(filter).toMatchObject({
			status: "filter",
			hash: instructionRuleHash(instruction.text),
		});
		const guidance = await compileInstructionRule(
			instruction,
			context,
			async () => ({ filters: [], summary: "" }),
			now,
		);
		expect(guidance.status).toBe("guidance");
		const failed = await compileInstructionRule(
			instruction,
			context,
			async () => {
				throw new Error("model down");
			},
			now,
		);
		expect(failed).toMatchObject({ status: "failed", error: "model down" });

		expect(activeRuleFilters([{ ...instruction, rule: filter }])).toEqual([
			outsideInbox,
		]);
		// Edited text or turned off: the old filter no longer applies.
		expect(
			activeRuleFilters([
				{ ...instruction, text: "Something else", rule: filter },
			]),
		).toEqual([]);
		expect(
			activeRuleFilters([{ ...instruction, enabled: false, rule: filter }]),
		).toEqual([]);

		expect(instructionEnforcement({ ...instruction, rule: filter })).toEqual({
			enforcement: "filter",
			enforcementSummary: "Hides Todoist tasks outside the Inbox",
		});
		expect(
			instructionEnforcement({ ...instruction, rule: guidance }).enforcement,
		).toBe("guidance");
		expect(
			instructionEnforcement({ ...instruction, rule: failed }).enforcement,
		).toBe("pending");
		expect(instructionEnforcement(instruction).enforcement).toBe("pending");
	});
});

describe("getFeedContent with instruction filters", () => {
	const hideTodos: FeedRuleFilter = {
		categories: ["todos"],
		providers: [],
		listMode: "any",
		lists: [],
		assignmentMode: "any",
		assignments: [],
	};

	beforeEach(() => {
		clearFeedCache();
		runs = 0;
		fs.rmSync(getDashboardFeedPath(), { force: true });
		fs.rmSync(getDashboardFeedStatePath(), { force: true });
		clearFeedStateCache();
	});

	it("drops excluded candidates before ranking and stores the compiled rule once", async () => {
		createTodo({ title: "Pay the plumber", priority: "high" });
		updateFeedState((s) => addInstruction(s, "Hide Toby todos", new Date()));
		let compiles = 0;
		const compileRule = async () => {
			compiles++;
			return { filters: [hideTodos], summary: "Hides Toby todos" };
		};

		const content = await getFeedContent({
			resolveModel: eligible,
			force: true,
			compileRule,
		});
		expect(content.items.some((i) => i.title === "Pay the plumber")).toBe(
			false,
		);
		expect(loadFeedState().instructions[0]?.rule?.status).toBe("filter");

		await getFeedContent({ resolveModel: eligible, force: true, compileRule });
		expect(compiles).toBe(1);
	});

	it("hides matching items from a cached ranking as soon as the rule exists", async () => {
		createTodo({ title: "Renew passport", priority: "high" });
		const first = await getFeedContent({ resolveModel: eligible, force: true });
		expect(first.items.some((i) => i.title === "Renew passport")).toBe(true);

		updateFeedState((s) => addInstruction(s, "Hide Toby todos", new Date()));
		const after = await getFeedContent({
			resolveModel: eligible,
			compileRule: async () => ({
				filters: [hideTodos],
				summary: "Hides Toby todos",
			}),
		});
		expect(after.items.some((i) => i.title === "Renew passport")).toBe(false);
	});
});
