import { currentDateTimePromptSection } from "../ai/current-datetime";
import type { Persona } from "../config/index";
import { formatItemsForPrompt } from "../dashboard/prompts";
import { composeSystemPromptWithPersona } from "../personas/prompt";
import { formatSkillsCatalogForPrompt, loadLocalSkills } from "../skills/index";
import { itemsFromDashboardToolResult } from "./dashboard-items";
import type { StoredLlmPromptHelpers } from "./document-types";
import type { FlowContextBag, FlowNodePromptContext } from "./types";

function valueToString(value: unknown, pretty: boolean): string {
	if (value === undefined) return "";
	if (value === null) return "null";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	try {
		return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function getBagKey(bag: Readonly<FlowContextBag>, key: string): unknown {
	return bag[key];
}

/**
 * Render a flow prompt template.
 *
 * Supported tokens:
 * - `{{bag.<key>}}` — compact JSON (or string) of bag value
 * - `{{json bag.<key>}}` — pretty-printed JSON
 * - `{{dashboardItems bag.<key>}}` — format dashboard tool result items
 * - `{{inputs.<name>}}` — resolved node input value
 */
export function renderFlowPromptTemplate(
	template: string,
	ctx: FlowNodePromptContext,
): string {
	return template.replace(
		/\{\{\s*(dashboardItems\s+bag\.([a-zA-Z0-9_]+)|json\s+bag\.([a-zA-Z0-9_]+)|bag\.([a-zA-Z0-9_]+)|inputs\.([a-zA-Z0-9_]+))\s*\}\}/g,
		(
			_match,
			_full: string,
			dashboardKey: string | undefined,
			jsonKey: string | undefined,
			bagKey: string | undefined,
			inputKey: string | undefined,
		) => {
			if (dashboardKey !== undefined) {
				const raw = getBagKey(ctx.bag, dashboardKey);
				const items = itemsFromDashboardToolResult(raw);
				return formatItemsForPrompt(items);
			}
			if (jsonKey !== undefined) {
				return valueToString(getBagKey(ctx.bag, jsonKey), true);
			}
			if (bagKey !== undefined) {
				return valueToString(getBagKey(ctx.bag, bagKey), false);
			}
			if (inputKey !== undefined) {
				return valueToString(ctx.inputs[inputKey], false);
			}
			return "";
		},
	);
}

/**
 * Apply optional system-prompt helpers after template render
 * (persona composition, skills catalog).
 */
export function applySystemPromptHelpers(
	rendered: string,
	helpers: StoredLlmPromptHelpers | undefined,
	persona: Persona,
): string {
	let out = rendered;
	if (helpers?.composePersona) {
		out = composeSystemPromptWithPersona(out, persona);
	}
	if (helpers?.appendSkillsCatalog) {
		const skills = loadLocalSkills().filter((s) => s.enabled !== false);
		const skillsCatalogText = formatSkillsCatalogForPrompt(skills);
		if (skillsCatalogText !== "(none)") {
			out = `${out}\n\nAvailable skills (apply relevant context from these):\n${skillsCatalogText}`;
		}
	}
	if (helpers?.appendCurrentDateTime) {
		out = `${out}\n\n${currentDateTimePromptSection()}\n\nAll event times must be written in the user's local timezone above (never UTC or raw ISO strings).`;
	}
	return out;
}

/** Full system prompt pipeline for a stored LLM node. */
export function renderStoredSystemPrompt(
	template: string,
	helpers: StoredLlmPromptHelpers | undefined,
	ctx: FlowNodePromptContext,
): string {
	const rendered = renderFlowPromptTemplate(template, ctx);
	return applySystemPromptHelpers(rendered, helpers, ctx.persona);
}

/** Full user prompt pipeline for a stored LLM node. */
export function renderStoredUserPrompt(
	template: string,
	ctx: FlowNodePromptContext,
): string {
	return renderFlowPromptTemplate(template, ctx);
}
