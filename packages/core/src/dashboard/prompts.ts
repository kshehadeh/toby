import type { Persona } from "../config/index";
import { readConfig } from "../config/index";
import { resolveDefaultPersona, resolvePersona } from "../personas/index";
import { composeSystemPromptWithPersona } from "../personas/prompt";
import type { DashboardItem } from "./types";

/** Resolve the persona configured for dashboard summaries, falling back to default. */
export function resolveDashboardPersona(): Persona {
	const config = readConfig();
	const name = config.dashboard?.persona?.trim();
	if (name) {
		const resolved = resolvePersona(name);
		if (resolved) return resolved;
	}
	return resolveDefaultPersona();
}

/** Built-in prompts per dashboard category. */
export const CATEGORY_PROMPTS: Record<string, string> = {
	email: `Summarize unread emails (ordered by recency and focusing on the ones that are not mass mailings).
The summary should surface emails that should be attended to first followed by those that are worth mentioning.
This should be no longer than 5-6 sentences.`,
	tasks: `Summarize my tasks and reminders focusing on the ones that are most urgent, are particularly late or appear to be important based on the description.
This should be no longer than 5-6 sentences.`,
	calendar: `Summarize my upcoming calendar events for the next week.
Call out what is happening soonest, any conflicts or back-to-back blocks if obvious from the list, and anything that looks like a meeting I should prepare for.
This should be no longer than 5-6 sentences. Use "Today", "Tommorow", "Later" headers.  Do not go beyond the next three business days.  So, if it's Friday,
summarize events for Friday, Saturday, Sunday, Monday, and Tuesday. But if it's Monday then just
summarize events for Monday, Tuesday, and Wednesday.  If there are no events in the next three business days, then just say "No upcoming events in the next three business days."`,
};

/**
 * Format dashboard items into readable text for the model.
 * Category-neutral labels (works for email, tasks, and calendar).
 */
export function formatItemsForPrompt(items: readonly DashboardItem[]): string {
	if (items.length === 0) return "(no items)";
	return items
		.map((item, idx) => {
			const title = item.title || "(untitled)";
			const subtitle = item.subtitle ? `\n   ${item.subtitle}` : "";
			const detail = item.detail ? `\n   ${item.detail}` : "";
			const time = item.timestamp ? `\n   when: ${item.timestamp}` : "";
			const urgency = item.urgency ? `\n   urgency: ${item.urgency}` : "";
			return `${idx + 1}. ${title}${subtitle}${detail}${time}${urgency}`;
		})
		.join("\n");
}

/** Build the full system prompt with persona instructions, category prompt, and skills catalog. */
export function buildDashboardSummarySystemPrompt(
	categoryPrompt: string,
	persona: Persona,
	skillsCatalogText: string,
): string {
	const base = `You are a personal assistant summarizing dashboard information for the user.

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

	const withPersona = composeSystemPromptWithPersona(base, persona);

	const skillsSection =
		skillsCatalogText !== "(none)"
			? `\n\nAvailable skills (apply relevant context from these):\n${skillsCatalogText}`
			: "";

	return `${withPersona}${skillsSection}`;
}
