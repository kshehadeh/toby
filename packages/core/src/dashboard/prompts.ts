import { formatLocalTimestampForPrompt } from "../ai/current-datetime";
import type { Persona } from "../config/index";
import { readConfig } from "../config/index";
import { resolveDefaultPersona, resolvePersona } from "../personas/index";
import type { DashboardItem } from "./types";

/** Resolve the persona configured for Home (The Feed), falling back to default. */
export function resolveDashboardPersona(): Persona {
	const config = readConfig();
	const name = config.dashboard?.persona?.trim();
	if (name) {
		const resolved = resolvePersona(name);
		if (resolved) return resolved;
	}
	return resolveDefaultPersona();
}

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
			const time = item.timestamp
				? `\n   when: ${formatLocalTimestampForPrompt(item.timestamp)}`
				: "";
			const urgency = item.urgency ? `\n   urgency: ${item.urgency}` : "";
			const url = item.url ? `\n   URL: ${item.url}` : "";
			return `${idx + 1}. ${title}${subtitle}${detail}${time}${urgency}${url}`;
		})
		.join("\n");
}
