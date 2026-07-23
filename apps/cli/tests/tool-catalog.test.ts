import { describe, expect, it } from "bun:test";
import { buildToolsCatalog } from "@toby/core/chat-pipeline/run-turn";
import { tool } from "ai";
import { z } from "zod";

describe("buildToolsCatalog", () => {
	it("produces a compact catalog with name + description + params", () => {
		const tools = {
			fetchOpenTasks: tool({
				description: "Fetch open tasks from Todoist",
				inputSchema: z.object({ projectId: z.string().optional() }),
				execute: async () => "ok",
			}),
			completeTask: tool({
				description: "Mark a task as completed",
				inputSchema: z.object({ taskId: z.string() }),
				execute: async () => "ok",
			}),
		};
		const catalog = buildToolsCatalog(tools);
		expect(catalog).toContain(
			"- fetchOpenTasks: Fetch open tasks from Todoist",
		);
		expect(catalog).toContain("params: projectId");
		expect(catalog).toContain("- completeTask: Mark a task as completed");
		expect(catalog).toContain("params: taskId");
	});

	it("handles tools without input schemas gracefully", () => {
		const tools = {
			getCurrentDateTime: tool({
				description: "Get the current local datetime",
				inputSchema: z.object({}),
				execute: async () => "ok",
			}),
		};
		const catalog = buildToolsCatalog(tools);
		expect(catalog).toContain(
			"- getCurrentDateTime: Get the current local datetime",
		);
		expect(catalog).not.toContain("params:");
	});

	it("returns (none) for empty tool sets", () => {
		const catalog = buildToolsCatalog({});
		expect(catalog).toBe("(none)");
	});
});
