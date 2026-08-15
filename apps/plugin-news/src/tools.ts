import {
	NewsFailure,
	type NewsSearchResult,
	fetchLatestNews,
	searchNews,
} from "./client";

type JsonRecord = Record<string, unknown>;

export type ToolDefinition = {
	name: string;
	displayName: string;
	description: string;
	readOnly?: boolean;
	inputSchema: {
		type: string;
		properties: Record<string, JsonRecord>;
		required?: string[];
	};
};

const SECTION_DESCRIPTION =
	"Optional Guardian section id such as world, us-news, uk-news, technology, business, sport, science, environment, culture, or politics. Omit to use the configured default (or all sections).";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: "getLatestNews",
		displayName: "Latest news",
		description:
			"Fetch the latest headlines from The Guardian. Optionally filter by section. Use this for 'what's in the news' or top stories.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				section: {
					type: "string",
					description: SECTION_DESCRIPTION,
				},
				limit: {
					type: "number",
					description: "Maximum articles to return (default 8, max 20)",
				},
				fromDate: {
					type: "string",
					description: "Optional earliest publication date (YYYY-MM-DD)",
				},
			},
		},
	},
	{
		name: "searchNews",
		displayName: "Search news",
		description:
			"Search recent Guardian articles by topic, person, place, or event. Prefer this over getLatestNews when the user names a subject.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search text, for example 'interest rates' or 'OpenAI'",
				},
				section: {
					type: "string",
					description: SECTION_DESCRIPTION,
				},
				limit: {
					type: "number",
					description: "Maximum articles to return (default 8, max 20)",
				},
				fromDate: {
					type: "string",
					description: "Optional earliest publication date (YYYY-MM-DD)",
				},
			},
			required: ["query"],
		},
	},
];

export class ToolFailure extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolFailure";
	}
}

type ExecuteResult = {
	result: NewsSearchResult | JsonRecord;
	appliedActions: string[];
};

function toToolError(error: unknown): ToolFailure {
	if (error instanceof ToolFailure) {
		return error;
	}
	if (error instanceof NewsFailure) {
		return new ToolFailure(error.message);
	}
	return new ToolFailure(
		error instanceof Error ? error.message : String(error),
	);
}

export async function executeTool(
	tool: string,
	input: JsonRecord,
	config: JsonRecord,
	dryRun: boolean,
): Promise<ExecuteResult> {
	switch (tool) {
		case "getLatestNews": {
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would fetch the latest Guardian headlines.",
					},
					appliedActions: [],
				};
			}
			try {
				const result = await fetchLatestNews(config, {
					section: input.section as string | undefined,
					limit: input.limit as number | undefined,
					fromDate: input.fromDate as string | undefined,
				});
				return { result, appliedActions: [] };
			} catch (error) {
				throw toToolError(error);
			}
		}

		case "searchNews": {
			const query = String(input.query ?? "").trim();
			if (!query) {
				throw new ToolFailure("query is required.");
			}
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: `Would search Guardian news for ${JSON.stringify(query)}.`,
					},
					appliedActions: [],
				};
			}
			try {
				const result = await searchNews(config, {
					query,
					section: input.section as string | undefined,
					limit: input.limit as number | undefined,
					fromDate: input.fromDate as string | undefined,
				});
				return { result, appliedActions: [] };
			} catch (error) {
				throw toToolError(error);
			}
		}

		default:
			throw new ToolFailure(`Unknown tool: ${tool}`);
	}
}
