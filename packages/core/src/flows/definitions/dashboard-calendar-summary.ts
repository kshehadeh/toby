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

const calendarSummarySchema = z.object({
	markdown: z
		.string()
		.describe(
			"User-facing markdown summary of upcoming calendar events only — no chain-of-thought",
		),
});

/**
 * Flow: fetch upcoming events via calendar.upcomingSummary (no LLM), then produce structured markdown.
 * Registered as `dashboard.calendar.summary`.
 *
 * Note: Tool Executor uses the active/default calendar provider (standardTool resolution).
 * Deterministic multi-provider merge for the card list still uses the dashboard aggregator.
 */
export const calendarDashboardSummaryFlow: FlowDefinition = {
	name: "dashboard.calendar.summary",
	description:
		"Fetch upcoming events via the calendar.upcomingSummary standard tool, then produce a short markdown summary with the dashboard persona.",
	resolvePersona: resolveDashboardPersona,
	nodes: [
		{
			id: "fetch-upcoming-events",
			type: "tool_executor",
			tool: { standardTool: "calendar.upcomingSummary" },
			inputs: {
				limit: { const: 50 },
			},
			outputs: { upcoming: "result" },
		},
		{
			id: "summarize",
			type: "llm_prompter",
			schema: calendarSummarySchema,
			schemaName: "CalendarDashboardSummary",
			schemaDescription:
				"Markdown summary of upcoming calendar events for the home dashboard",
			inputs: {
				data: { from: "upcoming" },
			},
			outputs: { summary: "object" },
			temperature: 0.3,
			maxOutputTokens: 3000,
			timeoutMs: 45_000,
			systemPrompt: (ctx) => {
				const skills = loadLocalSkills().filter((s) => s.enabled !== false);
				const skillsCatalogText = formatSkillsCatalogForPrompt(skills);
				return buildDashboardSummarySystemPrompt(
					CATEGORY_PROMPTS.calendar ?? "",
					ctx.persona,
					skillsCatalogText,
				);
			},
			userPrompt: (ctx) => {
				const items = itemsFromDashboardToolResult(ctx.bag.upcoming);
				const itemsText = formatItemsForPrompt(items);
				return `Here are the calendar items to summarize:\n\n${itemsText}`;
			},
		},
	],
};

registerFlow(calendarDashboardSummaryFlow);
