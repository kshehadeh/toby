import { z } from "zod";
import {
	CATEGORY_PROMPTS,
	buildDashboardSummarySystemPrompt,
	formatItemsForPrompt,
	resolveDashboardPersona,
} from "../../dashboard/prompts";
import {
	formatSkillsCatalogForPrompt,
	loadLocalSkills,
} from "../../skills/index";
import { registerFlow } from "../registry";
import type { FlowDefinition } from "../types";
import { itemsFromDashboardToolResult } from "./dashboard-shared";

const tasksSummarySchema = z.object({
	markdown: z
		.string()
		.describe(
			"User-facing markdown summary of open tasks/reminders only — no chain-of-thought",
		),
});

/**
 * Flow: fetch open tasks via tasks.openSummary (no LLM), then produce structured markdown.
 * Registered as `dashboard.tasks.summary`.
 *
 * Note: Tool Executor uses the active/default tasks provider (standardTool resolution).
 * Deterministic multi-provider merge for the card list still uses the dashboard aggregator.
 */
export const tasksDashboardSummaryFlow: FlowDefinition = {
	name: "dashboard.tasks.summary",
	description:
		"Fetch open tasks via the tasks.openSummary standard tool, then produce a short markdown summary with the dashboard persona.",
	resolvePersona: resolveDashboardPersona,
	nodes: [
		{
			id: "fetch-open-tasks",
			type: "tool_executor",
			tool: { standardTool: "tasks.openSummary" },
			inputs: {
				limit: { const: 50 },
			},
			outputs: { openTasks: "result" },
		},
		{
			id: "summarize",
			type: "llm_prompter",
			schema: tasksSummarySchema,
			schemaName: "TasksDashboardSummary",
			schemaDescription:
				"Markdown summary of open tasks for the home dashboard",
			inputs: {
				data: { from: "openTasks" },
			},
			outputs: { summary: "object" },
			temperature: 0.3,
			maxOutputTokens: 1500,
			timeoutMs: 45_000,
			systemPrompt: (ctx) => {
				const skills = loadLocalSkills().filter((s) => s.enabled !== false);
				const skillsCatalogText = formatSkillsCatalogForPrompt(skills);
				return buildDashboardSummarySystemPrompt(
					CATEGORY_PROMPTS.tasks ?? "",
					ctx.persona,
					skillsCatalogText,
				);
			},
			userPrompt: (ctx) => {
				const items = itemsFromDashboardToolResult(ctx.bag.openTasks);
				const itemsText = formatItemsForPrompt(items);
				return `Here are the tasks items to summarize:\n\n${itemsText}`;
			},
		},
	],
};

registerFlow(tasksDashboardSummaryFlow);
