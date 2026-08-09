import {
	addFlags,
	archiveMessages,
	deleteMessages,
	fetchMessageBody,
	fetchUnreadInbox,
	listMailboxes,
	moveMessages,
	parseEmailConfig,
	removeFlags,
	sendEmail,
	syncMailbox,
} from "./client";
import { type CachedMessage, type EmailDb, openDb } from "./db";
import { log } from "./log";

type JsonRecord = Record<string, unknown>;

const DEFAULT_MAILBOX = "INBOX";
const SNIPPET_MAX = 200;

/** Map a common IMAP host to its webmail inbox URL, if recognized. */
function webmailInboxUrl(imapHost: string): string | undefined {
	const host = imapHost.toLowerCase();
	if (host.includes("gmail") || host.includes("googlemail")) {
		return "https://mail.google.com/mail/u/0/#inbox";
	}
	if (
		host.includes("outlook") ||
		host.includes("office365") ||
		host.includes("hotmail") ||
		host.includes("live.com")
	) {
		return "https://outlook.office.com/mail/";
	}
	if (host.includes("yahoo")) {
		return "https://mail.yahoo.com/";
	}
	if (
		host.includes("icloud") ||
		host.includes("me.com") ||
		host.includes("mac.com")
	) {
		return "https://www.icloud.com/mail";
	}
	if (host.includes("proton")) {
		return "https://mail.proton.me/u/0/inbox";
	}
	if (host.includes("fastmail")) {
		return "https://app.fastmail.com/mail/Inbox";
	}
	if (host.includes("zoho")) {
		return "https://mail.zoho.com/";
	}
	return undefined;
}

function truncate(s: string, max: number): string {
	const t = s.replace(/\r?\n/g, " ").trim();
	return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function messageSummary(m: CachedMessage): JsonRecord {
	return {
		uid: m.uid,
		mailbox: m.mailbox,
		from: m.fromAddress,
		to: m.toAddress,
		subject: m.subject,
		date: m.date,
		snippet: truncate(m.snippet, SNIPPET_MAX),
		flags: m.flags,
		hasBody: m.hasBody,
	};
}

export const TOOL_DEFINITIONS = [
	{
		name: "getInboxOverview",
		displayName: "Fetch inbox overview",
		description:
			"List cached messages from a mailbox (default INBOX). Returns uid, from, subject, date, snippet for each message. Data comes from the local SQLite cache; use syncMailbox to refresh.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				mailbox: {
					type: "string",
					description: "IMAP mailbox name (default INBOX)",
				},
				limit: {
					type: "number",
					description: "Maximum messages to return (default 50)",
				},
				offset: {
					type: "number",
					description: "Skip this many messages (for pagination)",
				},
			},
		},
	},
	{
		name: "getUnreadSummary",
		displayName: "Unread inbox summary",
		description:
			"Dashboard summary of unread INBOX messages from the local cache. Returns a standardized shape with count, items, and generatedAt. Tagged as email.unreadSummary standard tool.",
		readOnly: true,
		standardTool: "email.unreadSummary",
		inputSchema: {
			type: "object",
			properties: {
				limit: {
					type: "number",
					description: "Maximum items to return (default 20)",
				},
			},
		},
	},
	{
		name: "getEmailMetadata",
		displayName: "Fetch email metadata",
		description:
			"Get cached metadata (from, to, cc, subject, date, snippet, flags) for specific message UIDs in a mailbox.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				uids: {
					type: "array",
					items: { type: "number" },
					minItems: 1,
					description: "Message UIDs to fetch metadata for",
				},
				mailbox: {
					type: "string",
					description: "IMAP mailbox name (default INBOX)",
				},
			},
			required: ["uids"],
		},
	},
	{
		name: "getEmailBody",
		displayName: "Fetch email body",
		description:
			"Get the full text and HTML body of a message. If the body is not cached locally, it will be fetched from the IMAP server.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				uid: { type: "number", description: "Message UID" },
				mailbox: {
					type: "string",
					description: "IMAP mailbox name (default INBOX)",
				},
			},
			required: ["uid"],
		},
	},
	{
		name: "searchEmails",
		displayName: "Search emails",
		description:
			"Search cached messages by keyword in subject, from, to, or snippet fields.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						"Search query (matched against subject, from, to, snippet)",
				},
				mailbox: {
					type: "string",
					description: "IMAP mailbox name (default INBOX)",
				},
				limit: {
					type: "number",
					description: "Maximum results (default 20)",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "syncMailbox",
		displayName: "Sync mailbox",
		description:
			"Trigger a manual IMAP sync to refresh the local cache: fetch new messages, prune messages no longer on the server, and refresh flags on recent cached messages. Write tools also sync automatically after they complete.",
		inputSchema: {
			type: "object",
			properties: {
				mailbox: {
					type: "string",
					description: "IMAP mailbox name (default INBOX)",
				},
			},
		},
	},
	{
		name: "listMailboxes",
		displayName: "List mailboxes",
		description:
			"List all available IMAP mailboxes (folders) on the server. Use this to find mailbox names for move operations and to see special-use folders like Trash, Sent, Drafts.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "markAsRead",
		displayName: "Mark emails as read",
		description:
			"Mark one or more messages as read by setting the \\Seen IMAP flag. Updates the local cache and re-syncs the mailbox afterward.",
		inputSchema: {
			type: "object",
			properties: {
				uids: {
					type: "array",
					items: { type: "number" },
					minItems: 1,
					description: "Message UIDs to mark as read",
				},
				mailbox: {
					type: "string",
					description: "IMAP mailbox name (default INBOX)",
				},
			},
			required: ["uids"],
		},
	},
	{
		name: "markAsUnread",
		displayName: "Mark emails as unread",
		description:
			"Mark one or more messages as unread by removing the \\Seen IMAP flag. Updates the local cache and re-syncs the mailbox afterward.",
		inputSchema: {
			type: "object",
			properties: {
				uids: {
					type: "array",
					items: { type: "number" },
					minItems: 1,
					description: "Message UIDs to mark as unread",
				},
				mailbox: {
					type: "string",
					description: "IMAP mailbox name (default INBOX)",
				},
			},
			required: ["uids"],
		},
	},
	{
		name: "setEmailFlags",
		displayName: "Set email flags",
		description:
			"Add or remove arbitrary IMAP flags on messages. Common flags: \\Seen (read), \\Flagged (starred), \\Answered (replied), \\Draft (draft). Custom labels (e.g. Gmail labels) may also be set this way. Updates the local cache and re-syncs the mailbox afterward.",
		inputSchema: {
			type: "object",
			properties: {
				uids: {
					type: "array",
					items: { type: "number" },
					minItems: 1,
					description: "Message UIDs to modify",
				},
				mailbox: {
					type: "string",
					description: "IMAP mailbox name (default INBOX)",
				},
				add: {
					type: "array",
					items: { type: "string" },
					description: "Flags to add (e.g. \\Flagged, \\Seen)",
				},
				remove: {
					type: "array",
					items: { type: "string" },
					description: "Flags to remove (e.g. \\Seen, \\Flagged)",
				},
			},
			required: ["uids"],
		},
	},
	{
		name: "moveToMailbox",
		displayName: "Move to mailbox",
		description:
			"Move one or more messages to a different IMAP mailbox. Use listMailboxes to find available mailbox names. Removes the messages from the source mailbox cache and re-syncs both source and destination afterward.",
		inputSchema: {
			type: "object",
			properties: {
				uids: {
					type: "array",
					items: { type: "number" },
					minItems: 1,
					description: "Message UIDs to move",
				},
				mailbox: {
					type: "string",
					description: "Source IMAP mailbox name (default INBOX)",
				},
				destination: {
					type: "string",
					description:
						"Destination mailbox name (e.g. Archive, [Gmail]/All Mail)",
				},
			},
			required: ["uids", "destination"],
		},
	},
	{
		name: "deleteEmail",
		displayName: "Delete email",
		description:
			"Delete one or more messages. If the server has a Trash mailbox, messages are moved there. Otherwise the \\Deleted flag is set and the mailbox is expunged. Removes them from the local cache and re-syncs the source (and Trash when used) afterward.",
		inputSchema: {
			type: "object",
			properties: {
				uids: {
					type: "array",
					items: { type: "number" },
					minItems: 1,
					description: "Message UIDs to delete",
				},
				mailbox: {
					type: "string",
					description: "IMAP mailbox name (default INBOX)",
				},
			},
			required: ["uids"],
		},
	},
	{
		name: "archiveEmail",
		displayName: "Archive email",
		description:
			"Archive one or more messages by moving them to the server's archive mailbox (auto-detected via the \\All special-use flag or common names like 'All Mail' or 'Archive'). Removes them from the local cache and re-syncs the source and archive mailboxes afterward.",
		inputSchema: {
			type: "object",
			properties: {
				uids: {
					type: "array",
					items: { type: "number" },
					minItems: 1,
					description: "Message UIDs to archive",
				},
				mailbox: {
					type: "string",
					description: "IMAP mailbox name (default INBOX)",
				},
			},
			required: ["uids"],
		},
	},
	{
		name: "createDraft",
		displayName: "Create draft",
		description:
			"Create a new email draft stored locally in the SQLite database. Drafts can be reviewed and sent via sendDraft.",
		inputSchema: {
			type: "object",
			properties: {
				to: {
					type: "array",
					items: { type: "string" },
					description: "Recipient email addresses",
				},
				cc: { type: "array", items: { type: "string" } },
				bcc: { type: "array", items: { type: "string" } },
				subject: { type: "string", description: "Email subject line" },
				body: { type: "string", description: "Email body (plain text)" },
			},
			required: ["to", "subject", "body"],
		},
	},
	{
		name: "updateDraft",
		displayName: "Update draft",
		description: "Update an existing draft by ID.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Draft ID" },
				to: { type: "array", items: { type: "string" } },
				cc: { type: "array", items: { type: "string" } },
				bcc: { type: "array", items: { type: "string" } },
				subject: { type: "string" },
				body: { type: "string" },
			},
			required: ["id"],
		},
	},
	{
		name: "listDrafts",
		displayName: "List drafts",
		description: "List all stored email drafts.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				limit: {
					type: "number",
					description: "Maximum drafts to return (default 25)",
				},
			},
		},
	},
	{
		name: "deleteDraft",
		displayName: "Delete draft",
		description: "Delete a stored draft by ID.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Draft ID to delete" },
			},
			required: ["id"],
		},
	},
	{
		name: "sendEmail",
		displayName: "Send email",
		description:
			"Send an email immediately via SMTP. Respects dryRun: when dryRun is true, returns what would be sent without actually sending.",
		inputSchema: {
			type: "object",
			properties: {
				to: {
					type: "array",
					items: { type: "string" },
					description: "Recipient email addresses",
				},
				cc: { type: "array", items: { type: "string" } },
				bcc: { type: "array", items: { type: "string" } },
				subject: { type: "string", description: "Email subject line" },
				body: { type: "string", description: "Email body (plain text)" },
			},
			required: ["to", "subject", "body"],
		},
	},
	{
		name: "sendDraft",
		displayName: "Send draft",
		description:
			"Send a stored draft via SMTP by draft ID. The draft is deleted after successful sending. Respects dryRun.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Draft ID to send" },
			},
			required: ["id"],
		},
	},
] as const;

function getStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string");
}

function getNumberArray(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is number => typeof v === "number");
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * After an IMAP write, re-sync affected mailboxes so the local SQLite cache
 * picks up new UIDs (e.g. moved messages in a destination folder) and stays
 * aligned with the server. Failures are logged and do not fail the write.
 */
export async function syncMailboxesAfterWrite(
	config: JsonRecord,
	db: EmailDb,
	mailboxes: string[],
	sync: typeof syncMailbox = syncMailbox,
): Promise<string[]> {
	const unique = [
		...new Set(mailboxes.map((m) => m.trim()).filter((m) => m.length > 0)),
	];
	const applied: string[] = [];
	for (const mailbox of unique) {
		try {
			const result = await sync(config, mailbox, db);
			applied.push(
				`Synced ${result.mailbox}: ${result.newCount} new message(s)`,
			);
			log.debug("post_write_sync_done", {
				mailbox: result.mailbox,
				newCount: result.newCount,
				lastUid: result.lastUid,
			});
		} catch (error) {
			log.warn("post_write_sync_failed", {
				mailbox,
				error: toErrorMessage(error),
			});
		}
	}
	return applied;
}

export async function executeTool(
	tool: string,
	input: JsonRecord,
	config: JsonRecord,
	dryRun: boolean,
	dataDir: string | undefined,
): Promise<{
	result: unknown;
	appliedActions?: string[];
}> {
	const db = openDb(dataDir);
	try {
		return await executeToolInner(tool, input, config, dryRun, db);
	} finally {
		db.close();
	}
}

async function executeToolInner(
	tool: string,
	input: JsonRecord,
	config: JsonRecord,
	dryRun: boolean,
	db: EmailDb,
): Promise<{ result: unknown; appliedActions?: string[] }> {
	const mailbox = String(input.mailbox ?? DEFAULT_MAILBOX);
	const limit = Number(input.limit ?? 50) || 50;
	const offset = Number(input.offset ?? 0) || 0;

	switch (tool) {
		case "getInboxOverview": {
			const messages = db.getMessages(mailbox, limit, offset);
			const total = db.countMessages(mailbox);
			return {
				result: {
					mailbox,
					total,
					pageSize: messages.length,
					messages: messages.map(messageSummary),
				},
			};
		}

		case "getUnreadSummary": {
			const summaryLimit = Number(input.limit ?? 20) || 20;
			// Read live from the server so the count reflects mail that is
			// currently unread AND still in the INBOX (messages read or
			// archived elsewhere are excluded).
			const unread = await fetchUnreadInbox(config, summaryLimit);

			const items = unread.messages.map((m) => {
				const isFlagged = m.flags.includes("\\Flagged");
				return {
					id: `${m.uid}:${DEFAULT_MAILBOX}`,
					title: m.subject || "(no subject)",
					subtitle: m.fromAddress,
					timestamp: m.date,
					urgency: isFlagged ? ("high" as const) : ("normal" as const),
					url: undefined,
				};
			});

			const launchUrl = webmailInboxUrl(parseEmailConfig(config).imapHost);
			return {
				result: {
					count: unread.count,
					items,
					...(launchUrl ? { launchUrl } : {}),
					generatedAt: new Date().toISOString(),
				},
			};
		}

		case "getEmailMetadata": {
			const uids = Array.isArray(input.uids)
				? input.uids.filter((u): u is number => typeof u === "number")
				: [];
			if (uids.length === 0) {
				return { result: { error: "uids is required and must be non-empty" } };
			}
			const messages = uids
				.map((uid) => db.getMessageByUid(uid, mailbox))
				.filter((m): m is CachedMessage => m !== null);
			return {
				result: {
					mailbox,
					messages: messages.map(messageSummary),
				},
			};
		}

		case "getEmailBody": {
			const uid = Number(input.uid);
			if (!uid) {
				return { result: { error: "uid is required" } };
			}

			// Try cache first
			let cached = db.getMessageBody(uid, mailbox);
			if (!cached) {
				// Fetch from IMAP
				if (dryRun) {
					return {
						result: {
							uid,
							mailbox,
							dryRun: true,
							note: "Body not in cache; would fetch from IMAP.",
						},
						appliedActions: [`Would fetch body for UID ${uid} from IMAP`],
					};
				}
				const body = await fetchMessageBody(config, mailbox, uid, db);
				cached = {
					uid,
					mailbox,
					textBody: body.textBody,
					htmlBody: body.htmlBody,
				};
			}

			return {
				result: {
					uid,
					mailbox,
					textBody: cached.textBody,
					htmlBody: cached.htmlBody,
				},
			};
		}

		case "searchEmails": {
			const query = String(input.query ?? "").trim();
			if (!query) {
				return { result: { error: "query is required" } };
			}
			const searchLimit = Number(input.limit ?? 20) || 20;
			const messages = db.searchMessages(query, mailbox, searchLimit);
			return {
				result: {
					mailbox,
					query,
					results: messages.map(messageSummary),
				},
			};
		}

		case "syncMailbox": {
			if (dryRun) {
				return {
					result: {
						mailbox,
						dryRun: true,
						note: "Would sync mailbox from IMAP.",
					},
					appliedActions: [`Would sync ${mailbox} from IMAP`],
				};
			}
			const result = await syncMailbox(config, mailbox, db);
			return {
				result: {
					mailbox: result.mailbox,
					newCount: result.newCount,
					lastUid: result.lastUid,
				},
				appliedActions: [
					`Synced ${result.mailbox}: ${result.newCount} new message(s)`,
				],
			};
		}

		case "listMailboxes": {
			if (dryRun) {
				return {
					result: { dryRun: true, note: "Would list IMAP mailboxes." },
					appliedActions: ["Would list IMAP mailboxes"],
				};
			}
			const mailboxes = await listMailboxes(config);
			return {
				result: {
					mailboxes: mailboxes.map((mb) => ({
						path: mb.path,
						name: mb.name,
						specialUse: mb.specialUse ?? null,
					})),
				},
			};
		}

		case "markAsRead": {
			const uids = getNumberArray(input.uids);
			if (uids.length === 0) {
				return { result: { error: "uids is required and must be non-empty" } };
			}
			if (dryRun) {
				return {
					result: { uids, mailbox, dryRun: true },
					appliedActions: [
						`Would mark ${uids.length} message(s) as read in ${mailbox}`,
					],
				};
			}
			await addFlags(config, mailbox, uids, ["\\Seen"]);
			db.updateFlags(uids, mailbox, "\\Seen", true);
			const syncActions = await syncMailboxesAfterWrite(config, db, [mailbox]);
			return {
				result: { uids, mailbox, marked: true },
				appliedActions: [
					`Marked ${uids.length} message(s) as read in ${mailbox}`,
					...syncActions,
				],
			};
		}

		case "markAsUnread": {
			const uids = getNumberArray(input.uids);
			if (uids.length === 0) {
				return { result: { error: "uids is required and must be non-empty" } };
			}
			if (dryRun) {
				return {
					result: { uids, mailbox, dryRun: true },
					appliedActions: [
						`Would mark ${uids.length} message(s) as unread in ${mailbox}`,
					],
				};
			}
			await removeFlags(config, mailbox, uids, ["\\Seen"]);
			db.updateFlags(uids, mailbox, "\\Seen", false);
			const syncActions = await syncMailboxesAfterWrite(config, db, [mailbox]);
			return {
				result: { uids, mailbox, marked: false },
				appliedActions: [
					`Marked ${uids.length} message(s) as unread in ${mailbox}`,
					...syncActions,
				],
			};
		}

		case "setEmailFlags": {
			const uids = getNumberArray(input.uids);
			if (uids.length === 0) {
				return { result: { error: "uids is required and must be non-empty" } };
			}
			const add = getStringArray(input.add);
			const remove = getStringArray(input.remove);
			if (add.length === 0 && remove.length === 0) {
				return {
					result: { error: "At least one of add or remove must be provided" },
				};
			}
			if (dryRun) {
				return {
					result: { uids, mailbox, add, remove, dryRun: true },
					appliedActions: [
						`Would update flags on ${uids.length} message(s) in ${mailbox}`,
					],
				};
			}
			if (add.length > 0) {
				await addFlags(config, mailbox, uids, add);
				for (const flag of add) db.updateFlags(uids, mailbox, flag, true);
			}
			if (remove.length > 0) {
				await removeFlags(config, mailbox, uids, remove);
				for (const flag of remove) db.updateFlags(uids, mailbox, flag, false);
			}
			const syncActions = await syncMailboxesAfterWrite(config, db, [mailbox]);
			return {
				result: { uids, mailbox, added: add, removed: remove },
				appliedActions: [
					`Updated flags on ${uids.length} message(s) in ${mailbox}`,
					...syncActions,
				],
			};
		}

		case "moveToMailbox": {
			const uids = getNumberArray(input.uids);
			if (uids.length === 0) {
				return { result: { error: "uids is required and must be non-empty" } };
			}
			const destination = String(input.destination ?? "").trim();
			if (!destination) {
				return { result: { error: "destination is required" } };
			}
			if (dryRun) {
				return {
					result: { uids, mailbox, destination, dryRun: true },
					appliedActions: [
						`Would move ${uids.length} message(s) from ${mailbox} to ${destination}`,
					],
				};
			}
			await moveMessages(config, mailbox, uids, destination);
			for (const uid of uids) {
				db.deleteMessage(uid, mailbox);
			}
			const syncActions = await syncMailboxesAfterWrite(config, db, [
				mailbox,
				destination,
			]);
			return {
				result: { uids, mailbox, destination, moved: true },
				appliedActions: [
					`Moved ${uids.length} message(s) from ${mailbox} to ${destination}`,
					...syncActions,
				],
			};
		}

		case "deleteEmail": {
			const uids = getNumberArray(input.uids);
			if (uids.length === 0) {
				return { result: { error: "uids is required and must be non-empty" } };
			}
			if (dryRun) {
				return {
					result: { uids, mailbox, dryRun: true },
					appliedActions: [
						`Would delete ${uids.length} message(s) from ${mailbox}`,
					],
				};
			}
			const { trashPath } = await deleteMessages(config, mailbox, uids);
			for (const uid of uids) {
				db.deleteMessage(uid, mailbox);
			}
			const mailboxesToSync = trashPath ? [mailbox, trashPath] : [mailbox];
			const syncActions = await syncMailboxesAfterWrite(
				config,
				db,
				mailboxesToSync,
			);
			return {
				result: {
					uids,
					mailbox,
					deleted: true,
					...(trashPath ? { trashPath } : {}),
				},
				appliedActions: [
					`Deleted ${uids.length} message(s) from ${mailbox}`,
					...syncActions,
				],
			};
		}

		case "archiveEmail": {
			const uids = getNumberArray(input.uids);
			if (uids.length === 0) {
				return { result: { error: "uids is required and must be non-empty" } };
			}
			if (dryRun) {
				return {
					result: { uids, mailbox, dryRun: true },
					appliedActions: [
						`Would archive ${uids.length} message(s) from ${mailbox}`,
					],
				};
			}
			const { archivePath } = await archiveMessages(config, mailbox, uids);
			for (const uid of uids) {
				db.deleteMessage(uid, mailbox);
			}
			const syncActions = await syncMailboxesAfterWrite(config, db, [
				mailbox,
				archivePath,
			]);
			return {
				result: { uids, mailbox, archived: true, archivePath },
				appliedActions: [
					`Archived ${uids.length} message(s) from ${mailbox} to ${archivePath}`,
					...syncActions,
				],
			};
		}

		case "createDraft": {
			const to = getStringArray(input.to);
			const cc = getStringArray(input.cc);
			const bcc = getStringArray(input.bcc);
			const subject = String(input.subject ?? "");
			const body = String(input.body ?? "");
			const now = new Date().toISOString();
			const id = `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;

			db.createDraft({
				id,
				toAddress: to.join(", "),
				ccAddress: cc.join(", "),
				bccAddress: bcc.join(", "),
				subject,
				body,
				createdAt: now,
				updatedAt: now,
			});

			return {
				result: { id, to, cc, bcc, subject, bodyPreview: truncate(body, 100) },
				appliedActions: [`Created draft: ${subject || "(no subject)"}`],
			};
		}

		case "updateDraft": {
			const id = String(input.id ?? "");
			if (!id) {
				return { result: { error: "id is required" } };
			}
			const existing = db.getDraft(id);
			if (!existing) {
				return { result: { error: `Draft ${id} not found` } };
			}

			const fields: Record<string, string> = {};
			if (Array.isArray(input.to))
				fields.toAddress = getStringArray(input.to).join(", ");
			if (Array.isArray(input.cc))
				fields.ccAddress = getStringArray(input.cc).join(", ");
			if (Array.isArray(input.bcc))
				fields.bccAddress = getStringArray(input.bcc).join(", ");
			if (typeof input.subject === "string") fields.subject = input.subject;
			if (typeof input.body === "string") fields.body = input.body;

			db.updateDraft(id, fields);
			return {
				result: { id, updated: true },
				appliedActions: [`Updated draft ${id}`],
			};
		}

		case "listDrafts": {
			const draftLimit = Number(input.limit ?? 25) || 25;
			const drafts = db.listDrafts(draftLimit);
			return {
				result: {
					drafts: drafts.map((d) => ({
						id: d.id,
						to: d.toAddress,
						cc: d.ccAddress,
						bcc: d.bccAddress,
						subject: d.subject,
						bodyPreview: truncate(d.body, 100),
						createdAt: d.createdAt,
						updatedAt: d.updatedAt,
					})),
				},
			};
		}

		case "deleteDraft": {
			const id = String(input.id ?? "");
			if (!id) {
				return { result: { error: "id is required" } };
			}
			const deleted = db.deleteDraft(id);
			return {
				result: { id, deleted },
				appliedActions: deleted ? [`Deleted draft ${id}`] : [],
			};
		}

		case "sendEmail": {
			const to = getStringArray(input.to);
			const cc = getStringArray(input.cc);
			const bcc = getStringArray(input.bcc);
			const subject = String(input.subject ?? "");
			const body = String(input.body ?? "");

			if (to.length === 0) {
				return { result: { error: "to is required" } };
			}

			if (dryRun) {
				return {
					result: {
						dryRun: true,
						to,
						cc,
						bcc,
						subject,
						bodyPreview: truncate(body, 100),
					},
					appliedActions: [`Would send email "${subject}" to ${to.join(", ")}`],
				};
			}

			const result = await sendEmail(config, to, subject, body, { cc, bcc });
			return {
				result: { messageId: result.messageId, to, subject },
				appliedActions: [`Sent email "${subject}" to ${to.join(", ")}`],
			};
		}

		case "sendDraft": {
			const id = String(input.id ?? "");
			if (!id) {
				return { result: { error: "id is required" } };
			}
			const draft = db.getDraft(id);
			if (!draft) {
				return { result: { error: `Draft ${id} not found` } };
			}

			const to = draft.toAddress
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			const cc = draft.ccAddress
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			const bcc = draft.bccAddress
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);

			if (to.length === 0) {
				return { result: { error: "Draft has no recipients" } };
			}

			if (dryRun) {
				return {
					result: {
						dryRun: true,
						draftId: id,
						to,
						subject: draft.subject,
					},
					appliedActions: [
						`Would send draft ${id} "${draft.subject}" to ${to.join(", ")}`,
					],
				};
			}

			const result = await sendEmail(config, to, draft.subject, draft.body, {
				cc,
				bcc,
			});
			db.deleteDraft(id);
			return {
				result: {
					messageId: result.messageId,
					draftId: id,
					to,
					subject: draft.subject,
				},
				appliedActions: [
					`Sent draft ${id} "${draft.subject}" to ${to.join(", ")}`,
				],
			};
		}

		default:
			return { result: { error: `Unknown tool: ${tool}` } };
	}
}
