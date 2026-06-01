import { tool } from "ai";
import { z } from "zod";
import { webSearch } from "./client";

interface BraveSearchToolContext {
	dryRun: boolean;
	appliedActions: string[];
}

export function createBraveSearchTools(ctx: BraveSearchToolContext) {
	return {
		webSearch: tool({
			description:
				"Search the web using Brave Search. Returns a list of results with title, URL, description, and optional page age. Use this to find information on the web, research topics, or look up facts.",
			inputSchema: z.object({
				query: z.string().min(1).describe("The search query"),
				count: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe("Number of results to return (1-20, default 10)"),
				freshness: z
					.enum(["pd", "pw", "pm", "py"])
					.optional()
					.describe(
						"Time filter: pd=past day, pw=past week, pm=past month, py=past year",
					),
			}),
			execute: async ({ query, count, freshness }) => {
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would search Brave for: "${query}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg, query };
				}

				const response = await webSearch(query, {
					count: count ?? 10,
					freshness,
				});

				const msg = `Brave Search: "${query}" — ${response.results.length} result(s)`;
				ctx.appliedActions.push(msg);

				return {
					ok: true,
					query: response.query,
					results: response.results,
				};
			},
		}),
	};
}
