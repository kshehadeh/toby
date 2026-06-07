import {
	postSlackMessage,
	searchConversations,
	searchSlackMessages,
	searchSlackUsers,
} from "./client";
import { consumeTokenRefreshPatch } from "./tokens";

type JsonRecord = Record<string, unknown>;

export const TOOL_DEFINITIONS = [
	{
		name: "postToChannel",
		description:
			"Post a new message to a Slack channel, private channel, or DM. Pass channel name (e.g. general), #channel, channel ID, or a username for DMs.",
		readOnly: false,
		inputSchema: {
			type: "object",
			properties: {
				channel: {
					type: "string",
					description:
						"Channel name, #channel, channel ID, or username for DM",
				},
				text: {
					type: "string",
					description: "Message text to post",
				},
			},
			required: ["channel", "text"],
		},
	},
	{
		name: "replyToPost",
		description:
			"Reply in a Slack thread. Requires the parent message timestamp (thread_ts) from the original post.",
		readOnly: false,
		inputSchema: {
			type: "object",
			properties: {
				channel: {
					type: "string",
					description:
						"Channel name, #channel, channel ID, or username for DM",
				},
				threadTs: {
					type: "string",
					description: "Parent message timestamp (thread_ts) to reply under",
				},
				text: {
					type: "string",
					description: "Reply text",
				},
			},
			required: ["channel", "threadTs", "text"],
		},
	},
	{
		name: "searchUsers",
		description:
			"Search workspace members by display name, username, or email. Email lookup uses users.lookupByEmail (requires users:read.email).",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						"Name, username, partial match, or full email address to search for",
				},
				limit: {
					type: "number",
					description: "Maximum users to return (default 20)",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "searchChannels",
		description:
			"Search Slack channels (public, private the bot is in). For people, prefer searchUsers.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						"Search text for channel/user names (empty returns a sample)",
				},
				limit: {
					type: "number",
					description: "Maximum matches per category (default 30)",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "searchMessages",
		description:
			"Search Slack message history across the workspace. Requires search scope on the connected token.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Slack search query (supports Slack search syntax)",
				},
				limit: {
					type: "number",
					description: "Maximum messages to return (default 20)",
				},
			},
			required: ["query"],
		},
	},
];

export async function executeTool(
	tool: string,
	input: JsonRecord,
	config: JsonRecord,
	dryRun: boolean,
): Promise<{
	result: unknown;
	appliedActions?: string[];
	config?: JsonRecord;
}> {
	const appliedActions: string[] = [];

	switch (tool) {
		case "postToChannel": {
			const channel = String(input.channel ?? "");
			const text = String(input.text ?? "");
			if (dryRun) {
				const msg = `[DRY RUN] Would post to Slack channel "${channel}": ${text}`;
				appliedActions.push(msg);
				return { result: { dryRun: true, message: msg }, appliedActions };
			}
			const result = await postSlackMessage({ config, channel, text });
			appliedActions.push(
				`Posted message to Slack channel "${channel}" (ts ${result.ts})`,
			);
			return {
				result: { success: true, ...result },
				appliedActions,
				config: consumeTokenRefreshPatch(),
			};
		}
		case "replyToPost": {
			const channel = String(input.channel ?? "");
			const threadTs = String(input.threadTs ?? "");
			const text = String(input.text ?? "");
			if (dryRun) {
				const msg = `[DRY RUN] Would reply in Slack thread ${threadTs} on "${channel}": ${text}`;
				appliedActions.push(msg);
				return { result: { dryRun: true, message: msg }, appliedActions };
			}
			const result = await postSlackMessage({
				config,
				channel,
				text,
				threadTs,
			});
			appliedActions.push(
				`Replied in Slack thread on "${channel}" (ts ${result.ts})`,
			);
			return {
				result: { success: true, ...result },
				appliedActions,
				config: consumeTokenRefreshPatch(),
			};
		}
		case "searchUsers": {
			const query = String(input.query ?? "");
			const limit =
				typeof input.limit === "number" ? input.limit : undefined;
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: `Would search Slack users for "${query}".`,
					},
				};
			}
			return {
				result: await searchSlackUsers(config, query, limit ?? 20),
				config: consumeTokenRefreshPatch(),
			};
		}
		case "searchChannels": {
			const query = String(input.query ?? "");
			const limit =
				typeof input.limit === "number" ? input.limit : undefined;
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: `Would search Slack channels/users for "${query}".`,
					},
				};
			}
			return {
				result: await searchConversations(config, query, limit ?? 30),
				config: consumeTokenRefreshPatch(),
			};
		}
		case "searchMessages": {
			const query = String(input.query ?? "");
			const limit =
				typeof input.limit === "number" ? input.limit : undefined;
			if (dryRun) {
				return {
					result: {
						dryRun: true,
						message: `Would search Slack messages for "${query}".`,
					},
				};
			}
			const messages = await searchSlackMessages(config, query, limit ?? 20);
			return {
				result: { messages, count: messages.length },
				config: consumeTokenRefreshPatch(),
			};
		}
		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}
