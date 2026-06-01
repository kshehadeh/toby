import { tool } from "ai";
import { z } from "zod";
import {
	archiveAppleMailMessageSync,
	createAppleMailDraftSync,
	isAppleMailPlatformSupported,
	listAppleMailAccountsSync,
	listMailboxesSync,
	moveAppleMailMessageSync,
	searchAppleMailEmailsSync,
	setAppleMailMessageFlaggedSync,
	updateAppleMailDraftSync,
} from "./client";

const MESSAGE_ID_SCHEMA = z
	.string()
	.regex(/^\d+$/, "Message id must be numeric (Mail.app message id)");

export interface AppleMailToolContext {
	readonly dryRun: boolean;
	readonly appliedActions: string[];
	/** Default list cap when the model omits `limit` (from `toby chat --max-results`). */
	readonly maxResults?: number;
}

export function createAppleMailTools(ctx: AppleMailToolContext) {
	return {
		listMailAccounts: tool({
			description:
				"List Mail.app account display names (and primary email when available). Use exact account names when passing the `account` filter to searchEmails, createDraft, archiveMailMessage, flagMailMessage, moveMailMessage, or listMailboxes.",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isAppleMailPlatformSupported()) {
					return { error: "Apple Mail tools only run on macOS.", accounts: [] };
				}
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would list Mail.app accounts.",
					};
				}
				const accounts = listAppleMailAccountsSync();
				return { count: accounts.length, accounts };
			},
		}),

		searchEmails: tool({
			description:
				"Search Apple Mail locally via Mail.app. Returns message id, subject, sender, date, read/flagged, mailbox, and account. Use numeric ids for updateDraft, archiveMailMessage, flagMailMessage, and moveMailMessage.",
			inputSchema: z.object({
				query: z
					.string()
					.optional()
					.describe("Match text in subject or sender"),
				from: z
					.string()
					.optional()
					.describe("Filter: sender contains this text"),
				subject: z
					.string()
					.optional()
					.describe("Filter: subject contains this text"),
				mailbox: z
					.string()
					.optional()
					.describe(
						"Mailbox name (e.g. INBOX). Omit to search all mailboxes in the account(s).",
					),
				account: z
					.string()
					.optional()
					.describe("Account display name. Omit to search all accounts."),
				unreadOnly: z.boolean().optional().describe("Only unread messages"),
				dateFrom: z
					.string()
					.optional()
					.describe("Start date for date received, e.g. January 1, 2026"),
				dateTo: z.string().optional().describe("End date for date received"),
				limit: z
					.number()
					.min(1)
					.max(200)
					.optional()
					.describe("Max results (default 30, max 200)"),
			}),
			execute: async (args) => {
				if (!isAppleMailPlatformSupported()) {
					return {
						error: "Apple Mail tools only run on macOS.",
						emails: [],
					};
				}
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would search Apple Mail with the given filters.",
					};
				}

				const cap = args.limit ?? ctx.maxResults ?? 30;
				const emails = searchAppleMailEmailsSync({
					query: args.query,
					from: args.from,
					subject: args.subject,
					mailbox: args.mailbox,
					account: args.account,
					unreadOnly: args.unreadOnly,
					dateFrom: args.dateFrom,
					dateTo: args.dateTo,
					limit: Math.min(Math.max(1, cap), 200),
				});

				return {
					count: emails.length,
					emails: emails.map((e) => ({
						id: e.id,
						subject: e.subject,
						sender: e.sender,
						dateReceived: e.dateReceived.toISOString(),
						isRead: e.isRead,
						isFlagged: e.isFlagged,
						mailbox: e.mailbox,
						account: e.account,
					})),
				};
			},
		}),

		createDraft: tool({
			description:
				"Create a new draft in Mail.app (not sent). Returns messageId for later updateDraft.",
			inputSchema: z.object({
				to: z.array(z.string()).min(1).describe("To addresses"),
				subject: z.string().min(1),
				body: z.string().min(1),
				cc: z.array(z.string()).optional(),
				bcc: z.array(z.string()).optional(),
				account: z
					.string()
					.optional()
					.describe("Account name to send from / assign draft to"),
			}),
			execute: async ({ to, subject, body, cc, bcc, account }) => {
				if (!isAppleMailPlatformSupported()) {
					return { error: "Apple Mail tools only run on macOS." };
				}
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would create draft to ${to.join(", ")} — "${subject}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				const result = createAppleMailDraftSync({
					to,
					subject,
					body,
					cc,
					bcc,
					account,
				});
				if (!result.ok) {
					return { error: result.error };
				}
				const line = `Created draft id ${result.messageId} — "${subject}"`;
				ctx.appliedActions.push(line);
				return { success: true, messageId: result.messageId, subject };
			},
		}),

		updateDraft: tool({
			description:
				"Update an existing draft by numeric messageId (from searchEmails or createDraft). Only works for messages in Drafts mailboxes.",
			inputSchema: z.object({
				id: MESSAGE_ID_SCHEMA,
				subject: z.string().optional(),
				body: z.string().optional(),
				to: z.array(z.string()).optional().describe("Replace To recipients"),
				cc: z.array(z.string()).optional(),
				bcc: z.array(z.string()).optional(),
			}),
			execute: async (args) => {
				if (!isAppleMailPlatformSupported()) {
					return { error: "Apple Mail tools only run on macOS." };
				}
				const hasPatch =
					args.subject !== undefined ||
					args.body !== undefined ||
					args.to !== undefined ||
					args.cc !== undefined ||
					args.bcc !== undefined;
				if (!hasPatch) {
					return {
						error:
							"Provide at least one of subject, body, to, cc, or bcc to update.",
					};
				}

				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would update draft id ${args.id}`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				const result = updateAppleMailDraftSync({
					id: args.id,
					subject: args.subject,
					body: args.body,
					to: args.to,
					cc: args.cc,
					bcc: args.bcc,
				});
				if (!result.ok) {
					return { error: result.error };
				}
				const line = `Updated draft id ${args.id}.`;
				ctx.appliedActions.push(line);
				return { success: true, id: args.id };
			},
		}),

		listMailboxes: tool({
			description:
				"List mailbox (folder) names per Mail.app account. Use exact mailbox names with moveMailMessage. Mail has no Gmail-style labels; folders are the practical equivalent.",
			inputSchema: z.object({
				account: z
					.string()
					.optional()
					.describe(
						"Account display name; omit to list mailboxes for all accounts.",
					),
			}),
			execute: async (args) => {
				if (!isAppleMailPlatformSupported()) {
					return {
						error: "Apple Mail tools only run on macOS.",
						mailboxes: [],
					};
				}
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would list Mail.app mailboxes.",
					};
				}
				const rows = listMailboxesSync(args.account);
				return { count: rows.length, mailboxes: rows };
			},
		}),

		archiveMailMessage: tool({
			description:
				'Archive a message in Mail.app by moving it to the first mailbox on the same account whose name contains "Archive" (case-insensitive). Requires a numeric message id from searchEmails.',
			inputSchema: z.object({
				id: MESSAGE_ID_SCHEMA,
				account: z
					.string()
					.optional()
					.describe(
						"Account display name to limit the search; omit to search all accounts (slower).",
					),
			}),
			execute: async (args) => {
				if (!isAppleMailPlatformSupported()) {
					return { error: "Apple Mail tools only run on macOS." };
				}
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would archive Mail message id ${args.id}`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}
				const result = archiveAppleMailMessageSync({
					id: args.id,
					account: args.account,
				});
				if (!result.ok) {
					return { error: result.error };
				}
				const line = `Archived Mail message id ${args.id}.`;
				ctx.appliedActions.push(line);
				return { success: true, id: args.id };
			},
		}),

		flagMailMessage: tool({
			description:
				"Set Mail.app flagged status on a message (built-in flag; closest to a tag). Requires numeric message id from searchEmails.",
			inputSchema: z.object({
				id: MESSAGE_ID_SCHEMA,
				flagged: z.boolean().describe("true to flag, false to clear the flag"),
				account: z
					.string()
					.optional()
					.describe(
						"Account display name to limit the search; omit to search all accounts.",
					),
			}),
			execute: async (args) => {
				if (!isAppleMailPlatformSupported()) {
					return { error: "Apple Mail tools only run on macOS." };
				}
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would set flagged=${args.flagged} on Mail message id ${args.id}`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}
				const result = setAppleMailMessageFlaggedSync({
					id: args.id,
					flagged: args.flagged,
					account: args.account,
				});
				if (!result.ok) {
					return { error: result.error };
				}
				const line = `Set flag on Mail message id ${args.id} to ${args.flagged}.`;
				ctx.appliedActions.push(line);
				return { success: true, id: args.id, flagged: args.flagged };
			},
		}),

		moveMailMessage: tool({
			description:
				"Move a message to a mailbox (folder) on the same Mail.app account — use for folder-as-label workflows. Prefer listMailboxes for exact mailbox names.",
			inputSchema: z.object({
				id: MESSAGE_ID_SCHEMA,
				mailbox: z
					.string()
					.min(1)
					.describe("Destination mailbox name (folder)"),
				account: z
					.string()
					.optional()
					.describe(
						"Account display name to limit the search; omit to search all accounts.",
					),
			}),
			execute: async (args) => {
				if (!isAppleMailPlatformSupported()) {
					return { error: "Apple Mail tools only run on macOS." };
				}
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would move Mail message id ${args.id} to mailbox "${args.mailbox}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}
				const result = moveAppleMailMessageSync({
					id: args.id,
					mailbox: args.mailbox,
					account: args.account,
				});
				if (!result.ok) {
					return { error: result.error };
				}
				const line = `Moved Mail message id ${args.id} to "${args.mailbox}".`;
				ctx.appliedActions.push(line);
				return { success: true, id: args.id, mailbox: args.mailbox };
			},
		}),
	};
}
