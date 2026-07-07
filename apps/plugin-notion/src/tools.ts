import {
	appendNotionPageContent,
	createNotionPage,
	getNotionPage,
	listNotionBlockChildren,
	markdownToBlocks,
	normalizeLimit,
	resolveParentPageId,
	searchNotion,
} from "./client";

type JsonRecord = Record<string, unknown>;

export const TOOL_DEFINITIONS = [
	{
		name: "searchNotion",
		displayName: "Search Notion",
		description:
			"Search accessible Notion pages and databases by query. Use before creating duplicate docs.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search query for Notion pages or databases",
				},
				limit: {
					type: "number",
					description: "Maximum results to return (default 10, max 100)",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "getNotionPage",
		displayName: "Get Notion page",
		description: "Fetch Notion page metadata by page id.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "Notion page id",
				},
			},
			required: ["pageId"],
		},
	},
	{
		name: "listNotionBlockChildren",
		displayName: "List Notion block children",
		description:
			"List child blocks for a Notion page or block id, returning summarized block text.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				blockId: {
					type: "string",
					description: "Notion page or block id",
				},
				limit: {
					type: "number",
					description: "Maximum blocks to return (default 30, max 100)",
				},
			},
			required: ["blockId"],
		},
	},
	{
		name: "createNotionPage",
		displayName: "Create Notion page",
		description:
			"Create a Notion page from markdown. Requires parentPageId or configured defaultParentPageId.",
		readOnly: false,
		inputSchema: {
			type: "object",
			properties: {
				title: {
					type: "string",
					minLength: 1,
					description: "Title for the new Notion page",
				},
				markdown: {
					type: "string",
					minLength: 1,
					description: "Markdown content to convert into Notion blocks",
				},
				parentPageId: {
					type: "string",
					description:
						"Optional Notion parent page id. Falls back to configured default parent page id.",
				},
			},
			required: ["title", "markdown"],
		},
	},
	{
		name: "appendNotionPageContent",
		displayName: "Append Notion page content",
		description: "Append markdown content to an existing Notion page.",
		readOnly: false,
		inputSchema: {
			type: "object",
			properties: {
				pageId: {
					type: "string",
					description: "Notion page id to append content to",
				},
				markdown: {
					type: "string",
					minLength: 1,
					description: "Markdown content to append as Notion blocks",
				},
			},
			required: ["pageId", "markdown"],
		},
	},
];

export async function executeTool(
	tool: string,
	input: JsonRecord,
	config: JsonRecord,
	dryRun: boolean,
): Promise<{ result: unknown; appliedActions?: string[] }> {
	const appliedActions: string[] = [];

	switch (tool) {
		case "searchNotion": {
			const query = requireString(input.query, "query");
			const limit = normalizeLimit(input.limit, 10);
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would search Notion.",
						query,
						limit,
					},
				};
			}
			return { result: { results: await searchNotion(config, query, limit) } };
		}

		case "getNotionPage": {
			const pageId = requireString(input.pageId, "pageId");
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would fetch Notion page metadata.",
						pageId,
					},
				};
			}
			return { result: { page: await getNotionPage(config, pageId) } };
		}

		case "listNotionBlockChildren": {
			const blockId = requireString(input.blockId, "blockId");
			const limit = normalizeLimit(input.limit, 30);
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would list Notion block children.",
						blockId,
						limit,
					},
				};
			}
			return {
				result: await listNotionBlockChildren(config, blockId, limit),
			};
		}

		case "createNotionPage": {
			const title = requireString(input.title, "title");
			const markdown = requireString(input.markdown, "markdown");
			const parentPageId = resolveParentPageId(config, input.parentPageId);
			const blockCount = markdownToBlocks(markdown).length;
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would create Notion page.",
						title,
						parentPageId,
						blockCount,
					},
				};
			}
			const page = await createNotionPage(config, {
				title,
				markdown,
				parentPageId,
			});
			appliedActions.push(`Created Notion page "${title}".`);
			return { result: { page }, appliedActions };
		}

		case "appendNotionPageContent": {
			const pageId = requireString(input.pageId, "pageId");
			const markdown = requireString(input.markdown, "markdown");
			const blockCount = markdownToBlocks(markdown).length;
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: "Would append content to Notion page.",
						pageId,
						blockCount,
					},
				};
			}
			const result = await appendNotionPageContent(config, pageId, markdown);
			appliedActions.push(`Appended content to Notion page ${pageId}.`);
			return { result, appliedActions };
		}

		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${field} is required.`);
	}
	return value.trim();
}
