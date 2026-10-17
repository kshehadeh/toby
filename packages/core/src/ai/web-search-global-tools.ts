import { type Tool, gateway, generateText, tool } from "ai";
import { z } from "zod";
import type { Persona } from "../config/index";
import { readConfig, readCredentials } from "../config/index";
import { gatewayFundsErrorBody } from "./gateway-funds";
import { createVercelGatewayModel } from "./model-factory";
import { reportToolProgress } from "./tool-progress";

/** Gateway model used for the internal search call (cheap and fast). */
const SEARCH_GATEWAY_MODEL = "openai/gpt-4.1-mini";

/**
 * Returns true when web search is enabled and the Vercel AI Gateway key
 * is configured. The persona parameter is accepted for backward
 * compatibility but no longer restricts availability — web search uses
 * a separate gateway call internally, so it works with any persona provider.
 */
export function isWebSearchAvailable(persona?: Persona | null): boolean {
	const config = readConfig();
	if (config.webSearch?.enabled !== true) return false;
	const creds = readCredentials();
	if (!creds.ai?.vercel?.apiKey?.trim()) return false;
	return true;
}

interface WebSearchToolContext {
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly appliedActions: string[];
}

/**
 * Build the `webSearch` global tool. Unlike a provider-executed tool
 * (which the gateway must support for the active model), this is a
 * client-side function tool whose `execute` makes a separate lightweight
 * gateway call with `gateway.tools.perplexitySearch()` to perform the
 * search. This means web search works with any persona AI provider,
 * not just the Vercel AI Gateway.
 *
 * Returns an empty record when web search is unavailable.
 */
export function createWebSearchGlobalTools(
	ctx: WebSearchToolContext,
): Record<string, Tool> {
	if (!isWebSearchAvailable(ctx.persona)) return {};

	return {
		webSearch: tool({
			description:
				"Search the web via Perplexity through the AI Gateway. Returns a list of results with title, URL, snippet, and optional date. Use this to find information on the web, research topics, or look up facts.",
			inputSchema: z.object({
				query: z
					.union([z.string(), z.array(z.string())])
					.describe(
						"Search query (string) or multiple queries (array of up to 5 strings). Multi-query searches return combined results.",
					),
				max_results: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe(
						"Maximum number of search results to return (1-20, default 10)",
					),
				search_recency_filter: z
					.enum(["day", "week", "month", "year"])
					.optional()
					.describe("Filter results by relative time period"),
				country: z
					.string()
					.optional()
					.describe(
						"Two-letter ISO 3166-1 alpha-2 country code for regional results (e.g. 'US', 'GB')",
					),
			}),
			execute: async (input) => {
				if (ctx.dryRun) {
					return { dryRun: true, query: input.query };
				}

				try {
					const model = createVercelGatewayModel(SEARCH_GATEWAY_MODEL);
					const searchProviderTool = gateway.tools.perplexitySearch({
						maxResults: input.max_results ?? 10,
						...(input.search_recency_filter
							? { searchRecencyFilter: input.search_recency_filter }
							: {}),
						...(input.country ? { country: input.country } : {}),
					});

					const queryText =
						typeof input.query === "string"
							? input.query
							: input.query.join(", ");
					const queries =
						typeof input.query === "string" ? [input.query] : input.query;
					reportToolProgress({
						items: queries.map((query, index) => ({
							id: `q${index}`,
							label: query,
							state: "running" as const,
						})),
					});

					const result = await generateText({
						model,
						tools: { search: searchProviderTool },
						toolChoice: { type: "tool", toolName: "search" },
						prompt: `Search the web for: ${queryText}`,
					});

					const toolResult = result.toolResults?.find(
						(r) => r.toolName === "search",
					);
					reportSearchResults(queries, toolResult?.output);
					return (
						toolResult?.output ?? {
							error: "No search results returned",
						}
					);
				} catch (e) {
					const funds = gatewayFundsErrorBody(e, "search the web", "vercel");
					if (funds) return funds;
					return {
						error: e instanceof Error ? e.message : "Web search failed",
					};
				}
			},
		}),
	};
}

/** Mark queries done and surface the top sources on the live rail. */
function reportSearchResults(
	queries: readonly string[],
	output: unknown,
): void {
	const results =
		output && typeof output === "object" && !Array.isArray(output)
			? (output as { results?: unknown }).results
			: undefined;
	const list = Array.isArray(results) ? results : [];
	const sources = list
		.slice(0, 3)
		.map((r, index) => {
			const record =
				r && typeof r === "object" ? (r as Record<string, unknown>) : {};
			const title = typeof record.title === "string" ? record.title : "";
			const url = typeof record.url === "string" ? record.url : undefined;
			return title
				? {
						id: `src${index}`,
						label: title,
						state: "done" as const,
						...(url ? { url } : {}),
					}
				: undefined;
		})
		.filter((item) => item !== undefined);
	reportToolProgress({
		items: [
			...queries.map((query, index) => ({
				id: `q${index}`,
				label: query,
				state: "done" as const,
				...(queries.length === 1
					? {
							detail: `${list.length} ${list.length === 1 ? "result" : "results"}`,
						}
					: {}),
			})),
			...sources,
		],
	});
}
