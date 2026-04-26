import { tool } from "ai";
import { z } from "zod";
import {
	type GmailMessage,
	applyLabels,
	archiveEmail,
	ensureLabels,
	fetchUnreadInbox,
	markEmailAsRead,
} from "./client";

export interface EmailContext {
	currentEmail: GmailMessage | null;
	dryRun: boolean;
	appliedActions: string[];
}

export function createGmailTools(ctx: EmailContext) {
	return {
		listLabels: tool({
			description: "List all labels in the user's Gmail account",
			inputSchema: z.object({}),
			execute: async () => {
				if (ctx.dryRun)
					return { dryRun: true, message: "Would list all Gmail labels" };
				const labelMap = await ensureLabels([]);
				const labels = Object.entries(labelMap).map(([name, id]) => ({
					name,
					id,
				}));
				return { labels };
			},
		}),

		createAndApplyLabel: tool({
			description:
				"Create a label (if it doesn't exist) and apply it to the current email being processed",
			inputSchema: z.object({
				labelName: z
					.string()
					.describe("The name of the label to create and apply"),
			}),
			execute: async ({ labelName }) => {
				if (!ctx.currentEmail) {
					return { error: "No email is currently being processed" };
				}

				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would apply label "${labelName}" to email "${ctx.currentEmail.subject}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				const labelMap = await ensureLabels([labelName]);
				const labelId = labelMap[labelName.toLowerCase()];
				if (!labelId) {
					return { error: `Failed to create label "${labelName}"` };
				}

				await applyLabels(ctx.currentEmail.id, [labelId]);
				const msg = `Applied label "${labelName}" to email "${ctx.currentEmail.subject}"`;
				ctx.appliedActions.push(msg);
				return {
					success: true,
					labelName,
					labelId,
					emailId: ctx.currentEmail.id,
				};
			},
		}),

		applyMultipleLabels: tool({
			description:
				"Apply multiple labels to the current email being processed. Creates labels if they don't exist.",
			inputSchema: z.object({
				labelNames: z
					.array(z.string())
					.describe("Array of label names to create and apply"),
			}),
			execute: async ({ labelNames }) => {
				if (!ctx.currentEmail) {
					return { error: "No email is currently being processed" };
				}

				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would apply labels [${labelNames.join(", ")}] to email "${ctx.currentEmail.subject}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				const labelMap = await ensureLabels(labelNames);
				const labelIds = labelNames
					.map((name) => labelMap[name.toLowerCase()])
					.filter(Boolean) as string[];

				if (labelIds.length === 0) {
					return { error: "Failed to resolve any label IDs" };
				}

				await applyLabels(ctx.currentEmail.id, labelIds);
				const msg = `Applied labels [${labelNames.join(", ")}] to email "${ctx.currentEmail.subject}"`;
				ctx.appliedActions.push(msg);
				return {
					success: true,
					labelNames,
					labelIds,
					emailId: ctx.currentEmail.id,
				};
			},
		}),

		markAsRead: tool({
			description:
				"Mark the current email as read by removing the UNREAD label",
			inputSchema: z.object({}),
			execute: async () => {
				if (!ctx.currentEmail) {
					return { error: "No email is currently being processed" };
				}

				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would mark email "${ctx.currentEmail.subject}" as read`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				await markEmailAsRead(ctx.currentEmail.id);

				const msg = `Marked email "${ctx.currentEmail.subject}" as read`;
				ctx.appliedActions.push(msg);
				return { success: true };
			},
		}),

		archiveEmail: tool({
			description: "Archive the current email by removing it from the inbox",
			inputSchema: z.object({}),
			execute: async () => {
				if (!ctx.currentEmail) {
					return { error: "No email is currently being processed" };
				}

				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would archive email "${ctx.currentEmail.subject}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				await archiveEmail(ctx.currentEmail.id);
				const msg = `Archived email "${ctx.currentEmail.subject}"`;
				ctx.appliedActions.push(msg);
				return { success: true };
			},
		}),

		getRecentEmails: tool({
			description:
				"Fetch recent unread emails from the inbox. Useful for getting context about other emails when deciding how to categorize the current one.",
			inputSchema: z.object({
				maxResults: z
					.number()
					.optional()
					.describe("Maximum number of emails to fetch (default 5)"),
			}),
			execute: async ({ maxResults }) => {
				if (ctx.dryRun) {
					return { dryRun: true, message: "Would fetch recent emails" };
				}

				const emails = await fetchUnreadInbox(maxResults ?? 5);
				return {
					emails: emails.map((e) => ({
						from: e.from,
						subject: e.subject,
						date: e.date,
						snippet: e.snippet.slice(0, 100),
					})),
				};
			},
		}),
	};
}
