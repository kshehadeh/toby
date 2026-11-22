import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// These tests delete the Feed files; never let that reach the real ~/.toby.
const testTobyDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-feed-test-"));
process.env.TOBY_DIR = testTobyDir;
afterAll(() => {
	fs.rmSync(testTobyDir, { recursive: true, force: true });
});

/** Count ranking runs without calling a model. */
let runs = 0;
mock.module("@toby/core/flows/runner", () => ({
	runFlow: async () => ({ ok: false, error: "unused", outputs: {} }),
	runFlowDefinition: async () => {
		runs += 1;
		return {
			ok: true,
			outputs: {
				ranking: {
					items: ["c1", "c2", "c3"].map((key) => ({
						key,
						tier: "today",
						priority: 50,
						reason: "High-priority todo.",
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
const { createTodo } = await import("@toby/core/todos/service");
const { getDashboardFeedPath, getDashboardFeedStatePath } = await import(
	"@toby/core/config/index"
);
const { clearFeedStateCache, setItemState, updateFeedState } = await import(
	"@toby/core/feed/state"
);

const eligible = async () =>
	({
		ok: true,
		ref: { provider: "openrouter", model: "openai/gpt-5-mini" },
		source: "config",
	}) as const;

describe("getFeedContent", () => {
	beforeEach(() => {
		process.env.TOBY_DIR = testTobyDir;
		clearFeedCache();
		runs = 0;
		fs.rmSync(getDashboardFeedPath(), { force: true });
		fs.rmSync(getDashboardFeedStatePath(), { force: true });
		clearFeedStateCache();
	});

	it("returns setupRequired without collecting or ranking when no model qualifies", async () => {
		const content = await getFeedContent({
			resolveModel: async () => ({ ok: false, reason: "Choose a Feed model" }),
		});
		expect(content.status).toBe("setupRequired");
		expect(content.setupReason).toBe("Choose a Feed model");
		expect(runs).toBe(0);
	});

	it("ranks once, serves the cached ranking for an unchanged set, and re-ranks on force", async () => {
		createTodo({ title: "File taxes", priority: "high" });

		const first = await getFeedContent({ resolveModel: eligible });
		expect(first.status).toBe("ok");
		expect(first.items[0]?.title).toBe("File taxes");
		expect(first.items[0]?.actions.map((a) => a.id)).toEqual([
			"task.help",
			"task.complete",
			"snooze",
			"notRelevant",
			"dismiss",
		]);
		expect(first.model).toEqual({
			provider: "openrouter",
			model: "openai/gpt-5-mini",
		});
		expect(runs).toBe(1);
		expect(fs.existsSync(getDashboardFeedPath())).toBe(true);

		const second = await getFeedContent({ resolveModel: eligible });
		expect(second.items).toEqual(first.items);
		expect(runs).toBe(1);

		await getFeedContent({ resolveModel: eligible, force: true });
		expect(runs).toBe(2);
	});

	it("filters dismissed items from the response and leaves them out of re-ranking", async () => {
		createTodo({ title: "Call the bank", priority: "high" });
		const first = await getFeedContent({ resolveModel: eligible, force: true });
		const target = first.items.find((i) => i.title === "Call the bank");
		expect(target).toBeDefined();
		const runsBefore = runs;

		updateFeedState((s) =>
			setItemState(s, target?.id ?? "", {
				kind: "dismissed",
				at: new Date().toISOString(),
			}),
		);
		const after = await getFeedContent({
			resolveModel: eligible,
			awaitRerank: true,
		});
		expect(after.items.some((i) => i.id === target?.id)).toBe(false);
		// The candidate set changed (item excluded) → one inline re-rank.
		expect(runs).toBe(runsBefore + 1);
	});
});
