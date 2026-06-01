import { tool } from "ai";
import { z } from "zod";
import {
	postSlackMessage,
	searchConversations,
	searchSlackMessages,
	searchSlackUsers,
} from "./client";

interface SlackToolContext {
	dryRun: boolean;
	appliedActions: string[];
}

export function createSlackTools(ctx: SlackToolContext) {
	return {
		postToChannel: tool({
			description:
				"Post a new message to a Slack channel, private channel, or DM. Pass channel name (e.g. general), #channel, channel ID, or a username for DMs.",
			inputSchema: z.object({
				channel: z
					.string()
					.describe("Channel name, #channel, channel ID, or username for DM"),
				text: z.string().describe("Message text to post"),
			}),
			execute: async ({ channel, text }) => {
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would post to Slack channel "${channel}": ${text}`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				const result = await postSlackMessage({ channel, text });
				const action = `Posted message to Slack channel "${channel}" (ts ${result.ts})`;
				ctx.appliedActions.push(action);
				return { success: true, ...result };
			},
		}),

		replyToPost: tool({
			description:
				"Reply in a Slack thread. Requires the parent message timestamp (thread_ts) from the original post.",
			inputSchema: z.object({
				channel: z
					.string()
					.describe("Channel name, #channel, channel ID, or username for DM"),
				threadTs: z
					.string()
					.describe("Parent message timestamp (thread_ts) to reply under"),
				text: z.string().describe("Reply text"),
			}),
			execute: async ({ channel, threadTs, text }) => {
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would reply in Slack thread ${threadTs} on "${channel}": ${text}`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				const result = await postSlackMessage({
					channel,
					text,
					threadTs,
				});
				const action = `Replied in Slack thread on "${channel}" (ts ${result.ts})`;
				ctx.appliedActions.push(action);
				return { success: true, ...result };
			},
		}),

		searchUsers: tool({
			description:
				"Search workspace members by display name, username, or email. Email lookup uses users.lookupByEmail (requires users:read.email).",
			inputSchema: z.object({
				query: z
					.string()
					.describe(
						"Name, username, partial match, or full email address to search for",
					),
				limit: z
					.number()
					.optional()
					.describe("Maximum users to return (default 20)"),
			}),
			execute: async ({ query, limit }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would search Slack users for "${query}".`,
					};
				}

				return searchSlackUsers(query, limit ?? 20);
			},
		}),

		searchChannels: tool({
			description:
				"Search Slack channels (public, private the bot is in). For people, prefer searchUsers.",
			inputSchema: z.object({
				query: z
					.string()
					.describe(
						"Search text for channel/user names (empty returns a sample)",
					),
				limit: z
					.number()
					.optional()
					.describe("Maximum matches per category (default 30)"),
			}),
			execute: async ({ query, limit }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would search Slack channels/users for "${query}".`,
					};
				}

				return searchConversations(query, limit ?? 30);
			},
		}),

		searchMessages: tool({
			description:
				"Search Slack message history across the workspace. Requires search scope on the connected token.",
			inputSchema: z.object({
				query: z
					.string()
					.describe("Slack search query (supports Slack search syntax)"),
				limit: z
					.number()
					.optional()
					.describe("Maximum messages to return (default 20)"),
			}),
			execute: async ({ query, limit }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would search Slack messages for "${query}".`,
					};
				}

				const messages = await searchSlackMessages(query, limit ?? 20);
				return { messages, count: messages.length };
			},
		}),
	};
}
