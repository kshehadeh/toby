import { beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";

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
					items: [
						{
							key: "c1",
							tier: "today",
							reason: "High-priority todo.",
							actions: ["task.help"],
						},
					],
				},
			},
		};
	},
}));

const { clearFeedCache, getFeedContent } = await import(
	"@toby/core/feed/index"
);
const { createTodo } = await import("@toby/core/todos/service");
const { getDashboardFeedPath } = await import("@toby/core/config/index");

const eligible = async () =>
	({
		ok: true,
		ref: { provider: "openrouter", model: "openai/gpt-5-mini" },
		source: "config",
	}) as const;

describe("getFeedContent", () => {
	beforeEach(() => {
		clearFeedCache();
		runs = 0;
		fs.rmSync(getDashboardFeedPath(), { force: true });
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
});
