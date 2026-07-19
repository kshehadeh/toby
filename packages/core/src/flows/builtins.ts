import { CATEGORY_PROMPTS } from "../dashboard/prompts";
import type { FlowDocument } from "./document-types";

/**
 * Shared base system prompt for dashboard summary LLM nodes.
 * Category-specific instructions are interpolated from CATEGORY_PROMPTS.
 * Persona + skills are applied at runtime via promptHelpers.
 */
function dashboardSummarySystemPrompt(categoryPrompt: string): string {
	return `You are a personal assistant summarizing dashboard information for the user.

${categoryPrompt}

CRITICAL OUTPUT RULES:
- Reply with ONLY the final user-facing summary in markdown.
- Do NOT include chain-of-thought, planning, self-checks, sentence counting, drafts, or analysis of these instructions.
- Do NOT write phrases like "we need to", "let's count", "the instruction says", "sentence 1:", or "also note".
- Start immediately with the summary (a heading or the first sentence for the user).

Format:
- Use **bold** for names, subjects, deadlines, and other key items the user should notice.
- Use bullet points for lists of items.
- Use a \`## \` sub-heading to separate "Needs attention" from "Worth mentioning" when appropriate.
- Keep the total response concise (5-6 sentences). Do not over-format — use markdown only where it genuinely aids readability.`;
}

const DASHBOARD_PROMPT_HELPERS = {
	composePersona: true,
	appendSkillsCatalog: true,
} as const;

function dashboardSummaryFlow(params: {
	readonly id: string;
	readonly description: string;
	readonly fetchNodeId: string;
	readonly standardTool: string;
	readonly bagKey: string;
	readonly schemaName: string;
	readonly schemaDescription: string;
	readonly categoryKey: keyof typeof CATEGORY_PROMPTS;
	readonly itemLabel: string;
}): FlowDocument {
	const categoryPrompt = CATEGORY_PROMPTS[params.categoryKey] ?? "";
	return {
		id: params.id,
		name: params.id,
		description: params.description,
		persona: { source: "dashboard" },
		nodes: [
			{
				id: params.fetchNodeId,
				type: "tool_executor",
				tool: { standardTool: params.standardTool },
				inputs: {
					limit: { const: 50 },
				},
				outputs: { [params.bagKey]: "result" },
			},
			{
				id: "summarize",
				type: "llm_prompter",
				schema: { kind: "markdown" },
				schemaName: params.schemaName,
				schemaDescription: params.schemaDescription,
				inputs: {
					data: { from: params.bagKey },
				},
				outputs: { summary: "object" },
				temperature: 0.3,
				maxOutputTokens: 3000,
				timeoutMs: 45_000,
				promptHelpers: DASHBOARD_PROMPT_HELPERS,
				systemPrompt: dashboardSummarySystemPrompt(categoryPrompt),
				userPrompt: `Here are the ${params.itemLabel} items to summarize:\n\n{{dashboardItems bag.${params.bagKey}}}`,
			},
		],
	};
}

export const emailDashboardSummaryDocument: FlowDocument = dashboardSummaryFlow(
	{
		id: "dashboard.email.summary",
		description:
			"Fetch unread inbox items via the email.unreadSummary standard tool, then produce a short markdown summary with the dashboard persona.",
		fetchNodeId: "fetch-unread",
		standardTool: "email.unreadSummary",
		bagKey: "unread",
		schemaName: "EmailDashboardSummary",
		schemaDescription:
			"Markdown summary of unread emails for the home dashboard",
		categoryKey: "email",
		itemLabel: "email",
	},
);

export const tasksDashboardSummaryDocument: FlowDocument = dashboardSummaryFlow(
	{
		id: "dashboard.tasks.summary",
		description:
			"Fetch open tasks via the tasks.openSummary standard tool, then produce a short markdown summary with the dashboard persona.",
		fetchNodeId: "fetch-open-tasks",
		standardTool: "tasks.openSummary",
		bagKey: "openTasks",
		schemaName: "TasksDashboardSummary",
		schemaDescription: "Markdown summary of open tasks for the home dashboard",
		categoryKey: "tasks",
		itemLabel: "tasks",
	},
);

export const calendarDashboardSummaryDocument: FlowDocument =
	dashboardSummaryFlow({
		id: "dashboard.calendar.summary",
		description:
			"Fetch upcoming events via the calendar.upcomingSummary standard tool, then produce a short markdown summary with the dashboard persona.",
		fetchNodeId: "fetch-upcoming-events",
		standardTool: "calendar.upcomingSummary",
		bagKey: "upcoming",
		schemaName: "CalendarDashboardSummary",
		schemaDescription:
			"Markdown summary of upcoming calendar events for the home dashboard",
		categoryKey: "calendar",
		itemLabel: "calendar",
	});

/** Built-in flow seed documents keyed by stable id. */
export const BUILTIN_FLOWS: Readonly<Record<string, FlowDocument>> = {
	[emailDashboardSummaryDocument.id]: emailDashboardSummaryDocument,
	[tasksDashboardSummaryDocument.id]: tasksDashboardSummaryDocument,
	[calendarDashboardSummaryDocument.id]: calendarDashboardSummaryDocument,
};

export function isBuiltinFlowId(id: string): boolean {
	return Object.hasOwn(BUILTIN_FLOWS, id.trim());
}

export function getBuiltinFlowDocument(id: string): FlowDocument | undefined {
	return BUILTIN_FLOWS[id.trim()];
}

export function listBuiltinFlowIds(): readonly string[] {
	return Object.keys(BUILTIN_FLOWS).sort((a, b) => a.localeCompare(b));
}
