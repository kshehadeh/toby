import { tool } from "ai";
import { z } from "zod";
import {
	type GmailMessage,
	applyLabels,
	archiveEmail,
	ensureLabels,
	fetchUnreadInbox,
	fetchUnreadMetadataByMessageIds,
	listInboxPage,
	listInboxUnreadPage,
	markEmailAsRead,
} from "./client";

const SUBJECT_PREVIEW_MAX = 80;

function truncateForLine(s: string, max: number): string {
	const t = s.replace(/\r?\n/g, " ").trim();
	if (t.length <= max) {
		return t;
	}
	return `${t.slice(0, max - 1)}…`;
}

/** After an action on a message id, best-effort subject for tool feedback / appliedActions. */
async function oneLineForMessageId(
	messageId: string,
	withSubject: (subject: string) => string,
	withoutSubject: string,
): Promise<string> {
	const [m] = await fetchUnreadMetadataByMessageIds([messageId], 1);
	const subj = m?.subject?.trim();
	if (subj) {
		return withSubject(truncateForLine(subj, SUBJECT_PREVIEW_MAX));
	}
	return withoutSubject;
}

export interface EmailContext {
	currentEmail: GmailMessage | null;
	dryRun: boolean;
	appliedActions: string[];
	/**
	 * Max ids per `messages.list` page for inbox overview tools.
	 * Omit for chat (uses Gmail max 500 per page; paginate with nextPageToken).
	 */
	listSampleMax?: number;
}

export function createGmailTools(ctx: EmailContext) {
	const listCap =
		ctx.listSampleMax === undefined
			? 500
			: Math.min(Math.max(1, ctx.listSampleMax), 500);

	return {
		getInboxUnreadOverview: tool({
			description:
				"Holistic inbox overview: one messages.list call for INBOX (optionally UNREAD). Returns Gmail resultSizeEstimate (approximate total matches), this page size, nextPageToken if more pages exist, and id/thread pairs for messages on this page (no bodies). Prefer this for questions like how many emails exist before fetching full metadata.",
			inputSchema: z.object({
				filter: z
					.object({
						mode: z
							.enum(["unread", "any"])
							.optional()
							.describe(
								'Filter mode. "unread" lists INBOX+UNREAD. "any" lists INBOX without filtering on unread.',
							),
						query: z
							.string()
							.optional()
							.describe(
								"Optional Gmail search query (q=...). Examples: from:amazon newer_than:7d subject:(invoice).",
							),
					})
					.optional()
					.describe("Optional filter parameters for the inbox overview."),
				pageToken: z
					.string()
					.optional()
					.describe(
						"Pass nextPageToken from a previous call to fetch the next page",
					),
			}),
			execute: async ({ filter, pageToken }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would fetch inbox overview",
					};
				}

				const mode = filter?.mode ?? "unread";
				const query = filter?.query?.trim() || undefined;
				const page =
					mode === "unread"
						? await listInboxUnreadPage(listCap, pageToken)
						: await listInboxPage(listCap, pageToken, {
								labelIds: ["INBOX"],
								query,
							});
				const uniqueThreads = new Set(
					page.messageSummaries.map((m) => m.threadId).filter(Boolean),
				);

				return {
					filterApplied: { mode, query: query ?? null },
					resultSizeEstimate: page.resultSizeEstimate,
					pageSize: page.pageSize,
					nextPageToken: page.nextPageToken,
					hasMorePages: Boolean(page.nextPageToken),
					uniqueThreadsOnPage: uniqueThreads.size,
					messageSummaries: page.messageSummaries,
				};
			},
		}),

		getUnreadEmailMetadataBatch: tool({
			description:
				"Load From/Subject/Date/snippet for specific message ids (up to 20). Use after getInboxUnreadOverview when you need subject lines or senders for a subset.",
			inputSchema: z.object({
				messageIds: z
					.array(z.string())
					.min(1)
					.max(20)
					.describe("Gmail message ids to load metadata for"),
			}),
			execute: async ({ messageIds }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would load metadata for ${messageIds.length} message(s)`,
					};
				}

				const emails = await fetchUnreadMetadataByMessageIds(messageIds, 20);
				return {
					emails: emails.map((e) => ({
						id: e.id,
						threadId: e.threadId,
						from: e.from,
						subject: e.subject,
						date: e.date,
						snippet: e.snippet.slice(0, 200),
					})),
				};
			},
		}),

		archiveEmailById: tool({
			description:
				"Archive a message by id (removes INBOX label). Use when you have a concrete messageId from getInboxUnreadOverview or getUnreadEmailMetadataBatch.",
			inputSchema: z.object({
				messageId: z.string().describe("Gmail message id"),
			}),
			execute: async ({ messageId }) => {
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would archive message "${messageId}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				await archiveEmail(messageId);
				const message = await oneLineForMessageId(
					messageId,
					(subj) => `Archived "${subj}".`,
					`Archived message ${messageId.length > 18 ? `${messageId.slice(0, 12)}…` : messageId}.`,
				);
				ctx.appliedActions.push(message);
				return { success: true, messageId, message };
			},
		}),

		markAsReadById: tool({
			description:
				"Mark a message as read by id (removes UNREAD). Use when you have a concrete messageId.",
			inputSchema: z.object({
				messageId: z.string().describe("Gmail message id"),
			}),
			execute: async ({ messageId }) => {
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would mark message "${messageId}" as read`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				await markEmailAsRead(messageId);
				const message = await oneLineForMessageId(
					messageId,
					(subj) => `Marked as read: "${subj}".`,
					`Marked as read: ${messageId.length > 18 ? `${messageId.slice(0, 12)}…` : messageId}.`,
				);
				ctx.appliedActions.push(message);
				return { success: true, messageId, message };
			},
		}),

		applyMultipleLabelsByMessageId: tool({
			description:
				"Create labels if needed and apply them to a message by id. Use when you have a concrete messageId.",
			inputSchema: z.object({
				messageId: z.string().describe("Gmail message id"),
				labelNames: z.array(z.string()).describe("Label names to apply"),
			}),
			execute: async ({ messageId, labelNames }) => {
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would apply labels [${labelNames.join(", ")}] to "${messageId}"`;
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

				await applyLabels(messageId, labelIds);
				const labelPart = labelNames.join(", ");
				const message = await oneLineForMessageId(
					messageId,
					(subj) => `Applied [${labelPart}] to "${subj}".`,
					`Applied [${labelPart}] to message ${messageId.length > 18 ? `${messageId.slice(0, 12)}…` : messageId}.`,
				);
				ctx.appliedActions.push(message);
				return {
					success: true,
					messageId,
					labelNames,
					labelIds,
					message,
				};
			},
		}),

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
				"Fetch recent unread inbox messages with From/Subject/snippet (per-message API calls). Prefer getInboxUnreadOverview for counts or paging ids only.",
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
