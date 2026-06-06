import { tool } from "ai";
import { z } from "zod";
import {
	type BatchModifyOperationResult,
	type GmailMessage,
	METADATA_BATCH_MAX,
	applyLabels,
	archiveEmail,
	batchModifyMessages,
	createDraft,
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
			description: `Load From/Subject/Date/snippet/labelIds for specific message ids (up to ${METADATA_BATCH_MAX}). Use after getInboxUnreadOverview when you need subject lines or senders — request as many ids as you need in one call (e.g. all ids on the first unread page for triage).`,
			inputSchema: z.object({
				messageIds: z
					.array(z.string())
					.min(1)
					.max(METADATA_BATCH_MAX)
					.describe("Gmail message ids to load metadata for"),
			}),
			execute: async ({ messageIds }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would load metadata for ${messageIds.length} message(s)`,
					};
				}

				const emails = await fetchUnreadMetadataByMessageIds(
					messageIds,
					METADATA_BATCH_MAX,
				);
				return {
					emails: emails.map((e) => ({
						id: e.id,
						threadId: e.threadId,
						from: e.from,
						subject: e.subject,
						date: e.date,
						snippet: e.snippet.slice(0, 200),
						labelIds: e.labelIds,
					})),
				};
			},
		}),

		batchModifyMessages: tool({
			description: `Batch-modify messages: apply/remove labels, archive, or mark-read for multiple messages in ONE call. Accepts an array of operations — each operation specifies target messageIds and which labels to add/remove. This is far more efficient than calling single-message tools in a loop. ALWAYS prefer this over archiveEmailById/markAsReadById/applyMultipleLabelsByMessageId when acting on 2+ messages.

Examples:
- Archive messages m1,m2: {operations:[{messageIds:["m1","m2"], removeLabelNames:["INBOX"]}]}
- Label m3 as "Finance" and mark read: {operations:[{messageIds:["m3"], addLabelNames:["Finance"], removeLabelNames:["UNREAD"]}]}
- Different labels per group: {operations:[{messageIds:["m1","m2"], addLabelNames:["Finance"]},{messageIds:["m3"], addLabelNames:["Travel"]}]}
- Archive some and label others: {operations:[{messageIds:["m1","m2"], removeLabelNames:["INBOX"]},{messageIds:["m3","m4"], addLabelNames:["Receipts"], removeLabelNames:["UNREAD"]}]}`,
			inputSchema: z.object({
				operations: z
					.array(
						z.object({
							messageIds: z
								.array(z.string())
								.min(1)
								.max(1000)
								.describe("Target message IDs for this operation"),
							addLabelNames: z
								.array(z.string())
								.optional()
								.describe(
									'Label names to add (created if needed). Use "INBOX" or "UNREAD" with caution — they are system labels.',
								),
							removeLabelNames: z
								.array(z.string())
								.optional()
								.describe(
									'Label names to remove. Use "INBOX" to archive, "UNREAD" to mark as read.',
								),
						}),
					)
					.min(1)
					.max(100)
					.describe(
						"Array of {messageIds, addLabelNames?, removeLabelNames?} groups. Group messages that share the same action into one operation.",
					),
			}),
			execute: async ({ operations }) => {
				// Collect all unique label names across all operations.
				const allLabelNames = new Set<string>();
				for (const op of operations) {
					for (const name of op.addLabelNames ?? []) {
						// Skip system labels that don't need resolution.
						if (!isGmailSystemLabel(name)) {
							allLabelNames.add(name);
						}
					}
					for (const name of op.removeLabelNames ?? []) {
						if (!isGmailSystemLabel(name)) {
							allLabelNames.add(name);
						}
					}
				}

				if (ctx.dryRun) {
					const summaries = operations.map((op) => {
						const parts: string[] = [];
						if (op.addLabelNames?.length) {
							parts.push(`+[${op.addLabelNames.join(", ")}]`);
						}
						if (op.removeLabelNames?.length) {
							parts.push(`-[${op.removeLabelNames.join(", ")}]`);
						}
						return `${op.messageIds.length} message(s) ${parts.join(" ")}`;
					});
					const msg = `[DRY RUN] Would batch modify: ${summaries.join("; ")}`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				// Resolve label names → IDs.
				const labelMap =
					allLabelNames.size > 0 ? await ensureLabels([...allLabelNames]) : {};

				// Map operations from label names to label IDs.
				const idOps = operations.map((op) => ({
					messageIds: [...op.messageIds],
					addLabelIds: (op.addLabelNames ?? [])
						.map((name) => resolveLabelName(name, labelMap))
						.filter(Boolean) as string[],
					removeLabelIds: (op.removeLabelNames ?? [])
						.map((name) => resolveLabelName(name, labelMap))
						.filter(Boolean) as string[],
				}));

				const results = await batchModifyMessages(idOps);

				// Build human-readable summary and push to appliedActions.
				const totalSucceeded = results.reduce(
					(sum, r) => sum + r.succeeded.length,
					0,
				);
				const totalFailed = results.reduce(
					(sum, r) => sum + r.failed.length,
					0,
				);

				if (totalSucceeded > 0) {
					const parts: string[] = [];
					for (const op of operations) {
						const actionParts: string[] = [];
						if (op.addLabelNames?.length) {
							actionParts.push(`+${op.addLabelNames.join(",")}`);
						}
						if (op.removeLabelNames?.length) {
							actionParts.push(`-${op.removeLabelNames.join(",")}`);
						}
						parts.push(
							`${actionParts.join(" ")} on ${op.messageIds.length} msg(s)`,
						);
					}
					const msg = `Batch: ${parts.join("; ")} — ${totalSucceeded} succeeded${totalFailed > 0 ? `, ${totalFailed} failed` : ""}`;
					ctx.appliedActions.push(msg);
				}

				return {
					totalSucceeded,
					totalFailed,
					results: results.map((r) => ({
						succeeded: r.succeeded.length,
						failed: r.failed.length,
						addLabelIds: r.addLabelIds,
						removeLabelIds: r.removeLabelIds,
					})),
				};
			},
		}),

		archiveEmailById: tool({
			description:
				"Archive a single message by id (removes INBOX label). For 2+ messages, use batchModifyMessages with removeLabelNames:['INBOX'] instead — it is far more efficient.",
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
				"Mark a single message as read by id (removes UNREAD). For 2+ messages, use batchModifyMessages with removeLabelNames:['UNREAD'] instead — it is far more efficient.",
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
				"Create labels if needed and apply them to a single message by id. For 2+ messages, use batchModifyMessages instead — it is far more efficient.",
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

		createDraft: tool({
			description:
				"Create a new draft email in Gmail. The draft will appear in the user's Drafts folder and can be reviewed/sent from Gmail.",
			inputSchema: z.object({
				to: z.array(z.string()).min(1).describe("Recipient email addresses"),
				cc: z.array(z.string()).optional().describe("CC email addresses"),
				bcc: z.array(z.string()).optional().describe("BCC email addresses"),
				subject: z.string().describe("Email subject line"),
				body: z.string().describe("Email body (plain text)"),
			}),
			execute: async ({ to, cc, bcc, subject, body }) => {
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would create draft to [${to.join(", ")}] subject "${truncateForLine(subject, 60)}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				const result = await createDraft({ to, cc, bcc, subject, body });
				const msg = `Created draft to [${to.join(", ")}] subject "${truncateForLine(subject, 60)}"`;
				ctx.appliedActions.push(msg);
				return {
					success: true,
					draftId: result.draftId,
					messageId: result.messageId,
					message: msg,
				};
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

/** Gmail system labels that are referenced by their exact uppercase name, not user labels. */
const GMAIL_SYSTEM_LABELS = new Set([
	"INBOX",
	"UNREAD",
	"STARRED",
	"IMPORTANT",
	"SENT",
	"DRAFT",
	"TRASH",
	"SPAM",
	"CHAT",
	"CATEGORY_PERSONAL",
	"CATEGORY_SOCIAL",
	"CATEGORY_PROMOTIONS",
	"CATEGORY_UPDATES",
	"CATEGORY_FORUMS",
]);

function isGmailSystemLabel(name: string): boolean {
	return GMAIL_SYSTEM_LABELS.has(name.toUpperCase());
}

/**
 * Resolve a label name to its Gmail ID.
 * System labels (INBOX, UNREAD, etc.) are returned as-is (their name = their ID).
 * User labels are looked up in the labelMap from ensureLabels.
 */
function resolveLabelName(
	name: string,
	labelMap: Record<string, string>,
): string | undefined {
	if (isGmailSystemLabel(name)) {
		return name.toUpperCase();
	}
	return labelMap[name.toLowerCase()];
}
