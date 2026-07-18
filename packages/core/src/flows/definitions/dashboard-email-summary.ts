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

const emailSummarySchema = z.object({
	markdown: z
		.string()
		.describe(
			"User-facing markdown summary of unread emails only — no chain-of-thought",
		),
});

/**
 * Flow: fetch unread email metadata (no LLM), then produce structured markdown.
 * Registered as `dashboard.email.summary`.
 */
export const emailDashboardSummaryFlow: FlowDefinition = {
	name: "dashboard.email.summary",
	description:
		"Fetch unread inbox items via the email.unreadSummary standard tool, then produce a short markdown summary with the dashboard persona.",
	resolvePersona: resolveDashboardPersona,
	nodes: [
		{
			id: "fetch-unread",
			type: "tool_executor",
			tool: { standardTool: "email.unreadSummary" },
			inputs: {
				limit: { const: 50 },
			},
			// Tool executor result shape: { result, moduleName, toolName, ... }
			// Write the plugin result under context key "unread".
			outputs: { unread: "result" },
		},
		{
			id: "summarize",
			type: "llm_prompter",
			schema: emailSummarySchema,
			schemaName: "EmailDashboardSummary",
			schemaDescription:
				"Markdown summary of unread emails for the home dashboard",
			inputs: {
				data: { from: "unread" },
			},
			outputs: { summary: "object" },
			temperature: 0.3,
			maxOutputTokens: 1500,
			timeoutMs: 45_000,
			systemPrompt: (ctx) => {
				const skills = loadLocalSkills().filter((s) => s.enabled !== false);
				const skillsCatalogText = formatSkillsCatalogForPrompt(skills);
				return buildDashboardSummarySystemPrompt(
					CATEGORY_PROMPTS.email ?? "",
					ctx.persona,
					skillsCatalogText,
				);
			},
			userPrompt: (ctx) => {
				const items = itemsFromDashboardToolResult(ctx.bag.unread);
				const itemsText = formatItemsForPrompt(items);
				return `Here are the email items to summarize:\n\n${itemsText}`;
			},
		},
	],
};

registerFlow(emailDashboardSummaryFlow);
