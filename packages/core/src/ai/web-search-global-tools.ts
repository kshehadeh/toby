import type { Tool } from "ai";
import { gateway } from "ai";
import type { Persona } from "../config/index";
import { readConfig, readCredentials } from "../config/index";

/**
 * Returns true when web search is enabled, the Vercel AI Gateway key is
 * configured, and (when a persona is supplied) the persona's AI provider
 * is the Vercel AI Gateway — the only provider that can execute the
 * gateway's built-in Perplexity search tool.
 */
export function isWebSearchAvailable(persona?: Persona | null): boolean {
	const config = readConfig();
	if (config.webSearch?.enabled !== true) return false;
	const creds = readCredentials();
	if (!creds.ai?.vercel?.apiKey?.trim()) return false;
	if (persona && persona.ai.provider !== "vercel") return false;
	return true;
}

interface WebSearchToolContext {
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly appliedActions: string[];
}

/**
 * Build the `webSearch` global tool using the AI Gateway's built-in
 * Perplexity search. The tool is a provider-executed tool — the Vercel
 * AI Gateway runs the search server-side during model generation.
 *
 * Returns an empty record when web search is unavailable (disabled,
 * missing gateway key, or persona does not use the Vercel AI Gateway).
 */
export function createWebSearchGlobalTools(
	ctx: WebSearchToolContext,
): Record<string, Tool> {
	if (!isWebSearchAvailable(ctx.persona)) return {};

	const searchTool = gateway.tools.perplexitySearch({
		maxResults: 10,
	});

	return { webSearch: searchTool as unknown as Tool };
}
