import {
	type GmailMessage,
	METADATA_BATCH_MAX,
	applyLabels,
	archiveEmail,
	batchModifyMessages,
	consumeTokenRefreshPatch,
	createDraft,
	ensureLabels,
	fetchUnreadInbox,
	fetchUnreadMetadataByMessageIds,
	listInboxPage,
	listInboxUnreadPage,
	markEmailAsRead,
} from "./client";

type JsonRecord = Record<string, unknown>;

const SUBJECT_PREVIEW_MAX = 80;
const LIST_CAP_DEFAULT = 500;

function truncateForLine(s: string, max: number): string {
	const t = s.replace(/\r?\n/g, " ").trim();
	if (t.length <= max) return t;
	return `${t.slice(0, max - 1)}…`;
}

async function oneLineForMessageId(
	config: JsonRecord,
	messageId: string,
	withSubject: (subject: string) => string,
	withoutSubject: string,
): Promise<string> {
	const [m] = await fetchUnreadMetadataByMessageIds(config, [messageId], 1);
	const subj = m?.subject?.trim();
	if (subj) {
		return withSubject(truncateForLine(subj, SUBJECT_PREVIEW_MAX));
	}
	return withoutSubject;
}

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

function resolveLabelName(
	name: string,
	labelMap: Record<string, string>,
): string | undefined {
	if (isGmailSystemLabel(name)) {
		return name.toUpperCase();
	}
	return labelMap[name.toLowerCase()];
}

export const TOOL_DEFINITIONS = [
	{
		name: "getInboxUnreadOverview",
		description:
			"Holistic inbox overview: one messages.list call for INBOX (optionally UNREAD). Returns Gmail resultSizeEstimate (approximate total matches), this page size, nextPageToken if more pages exist, and id/thread pairs for messages on this page (no bodies). Prefer this for questions like how many emails exist before fetching full metadata.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				filter: {
					type: "object",
					properties: {
						mode: {
							type: "string",
							enum: ["unread", "any"],
							description:
								'Filter mode. "unread" lists INBOX+UNREAD. "any" lists INBOX without filtering on unread.',
						},
						query: {
							type: "string",
							description:
								"Optional Gmail search query (q=...). Examples: from:amazon newer_than:7d subject:(invoice).",
						},
					},
				},
				pageToken: {
					type: "string",
					description:
						"Pass nextPageToken from a previous call to fetch the next page",
				},
			},
		},
	},
	{
		name: "getUnreadEmailMetadataBatch",
		description: `Load From/Subject/Date/snippet/labelIds for specific message ids (up to ${METADATA_BATCH_MAX}). Use after getInboxUnreadOverview when you need subject lines or senders — request as many ids as you need in one call (e.g. all ids on the first unread page for triage).`,
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				messageIds: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					maxItems: METADATA_BATCH_MAX,
					description: "Gmail message ids to load metadata for",
				},
			},
			required: ["messageIds"],
		},
	},
	{
		name: "batchModifyMessages",
		description:
			"Batch-modify messages: apply/remove labels, archive, or mark-read for multiple messages in ONE call. Accepts an array of operations — each operation specifies target messageIds and which labels to add/remove. ALWAYS prefer this over single-message tools when acting on 2+ messages.",
		inputSchema: {
			type: "object",
			properties: {
				operations: {
					type: "array",
					minItems: 1,
					maxItems: 100,
					items: {
						type: "object",
						properties: {
							messageIds: {
								type: "array",
								items: { type: "string" },
								minItems: 1,
								maxItems: 1000,
							},
							addLabelNames: {
								type: "array",
								items: { type: "string" },
							},
							removeLabelNames: {
								type: "array",
								items: { type: "string" },
							},
						},
						required: ["messageIds"],
					},
				},
			},
			required: ["operations"],
		},
	},
	{
		name: "archiveEmailById",
		description:
			"Archive a single message by id (removes INBOX label). For 2+ messages, use batchModifyMessages with removeLabelNames:['INBOX'] instead.",
		inputSchema: {
			type: "object",
			properties: {
				messageId: { type: "string", description: "Gmail message id" },
			},
			required: ["messageId"],
		},
	},
	{
		name: "markAsReadById",
		description:
			"Mark a single message as read by id (removes UNREAD). For 2+ messages, use batchModifyMessages with removeLabelNames:['UNREAD'] instead.",
		inputSchema: {
			type: "object",
			properties: {
				messageId: { type: "string", description: "Gmail message id" },
			},
			required: ["messageId"],
		},
	},
	{
		name: "applyMultipleLabelsByMessageId",
		description:
			"Create labels if needed and apply them to a single message by id. For 2+ messages, use batchModifyMessages instead.",
		inputSchema: {
			type: "object",
			properties: {
				messageId: { type: "string", description: "Gmail message id" },
				labelNames: {
					type: "array",
					items: { type: "string" },
					description: "Label names to apply",
				},
			},
			required: ["messageId", "labelNames"],
		},
	},
	{
		name: "listLabels",
		description: "List all labels in the user's Gmail account",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "createDraft",
		description:
			"Create a new draft email in Gmail. The draft will appear in the user's Drafts folder and can be reviewed/sent from Gmail.",
		inputSchema: {
			type: "object",
			properties: {
				to: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
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
		name: "getRecentEmails",
		description:
			"Fetch recent unread inbox messages with From/Subject/snippet (per-message API calls). Prefer getInboxUnreadOverview for counts or paging ids only.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				maxResults: {
					type: "number",
					description: "Maximum number of emails to fetch (default 5)",
				},
			},
		},
	},
] as const;

export async function executeTool(
	tool: string,
	input: JsonRecord,
	config: JsonRecord,
	dryRun: boolean,
): Promise<{
	result: unknown;
	appliedActions?: string[];
	config?: Record<string, unknown>;
}> {
	const appliedActions: string[] = [];

	switch (tool) {
		case "getInboxUnreadOverview": {
			if (dryRun) {
				return withTokenPatch({
					dryRun: true,
					message: "Would fetch inbox overview",
				});
			}
			const filter =
				input.filter && typeof input.filter === "object"
					? (input.filter as JsonRecord)
					: {};
			const mode = filter.mode === "any" ? "any" : "unread";
			const query =
				typeof filter.query === "string" ? filter.query.trim() : undefined;
			const pageToken =
				typeof input.pageToken === "string" ? input.pageToken : undefined;
			const page =
				mode === "unread"
					? await listInboxUnreadPage(config, LIST_CAP_DEFAULT, pageToken)
					: await listInboxPage(config, LIST_CAP_DEFAULT, pageToken, {
							labelIds: ["INBOX"],
							query: query || undefined,
						});
			const uniqueThreads = new Set(
				page.messageSummaries.map((m) => m.threadId).filter(Boolean),
			);
			return withTokenPatch({
				filterApplied: { mode, query: query ?? null },
				resultSizeEstimate: page.resultSizeEstimate,
				pageSize: page.pageSize,
				nextPageToken: page.nextPageToken,
				hasMorePages: Boolean(page.nextPageToken),
				uniqueThreadsOnPage: uniqueThreads.size,
				messageSummaries: page.messageSummaries,
			});
		}

		case "getUnreadEmailMetadataBatch": {
			const messageIds = Array.isArray(input.messageIds)
				? input.messageIds.map(String)
				: [];
			if (dryRun) {
				return withTokenPatch({
					dryRun: true,
					message: `Would load metadata for ${messageIds.length} message(s)`,
				});
			}
			const emails = await fetchUnreadMetadataByMessageIds(
				config,
				messageIds,
				METADATA_BATCH_MAX,
			);
			return withTokenPatch({
				emails: emails.map((e) => ({
					id: e.id,
					threadId: e.threadId,
					from: e.from,
					subject: e.subject,
					date: e.date,
					snippet: e.snippet.slice(0, 200),
					labelIds: e.labelIds,
				})),
			});
		}

		case "batchModifyMessages": {
			const operations = Array.isArray(input.operations)
				? (input.operations as JsonRecord[])
				: [];
			const allLabelNames = new Set<string>();
			for (const op of operations) {
				for (const name of (op.addLabelNames as string[] | undefined) ?? []) {
					if (!isGmailSystemLabel(name)) allLabelNames.add(name);
				}
				for (const name of (op.removeLabelNames as string[] | undefined) ??
					[]) {
					if (!isGmailSystemLabel(name)) allLabelNames.add(name);
				}
			}

			if (dryRun) {
				const summaries = operations.map((op) => {
					const ids = (op.messageIds as string[] | undefined) ?? [];
					const parts: string[] = [];
					const add = (op.addLabelNames as string[] | undefined) ?? [];
					const remove = (op.removeLabelNames as string[] | undefined) ?? [];
					if (add.length) parts.push(`+[${add.join(", ")}]`);
					if (remove.length) parts.push(`-[${remove.join(", ")}]`);
					return `${ids.length} message(s) ${parts.join(" ")}`;
				});
				const msg = `[DRY RUN] Would batch modify: ${summaries.join("; ")}`;
				appliedActions.push(msg);
				return withTokenPatch({ dryRun: true, message: msg }, appliedActions);
			}

			const labelMap =
				allLabelNames.size > 0
					? await ensureLabels(config, [...allLabelNames])
					: {};
			const idOps = operations.map((op) => ({
				messageIds: ((op.messageIds as string[] | undefined) ?? []).map(String),
				addLabelIds: ((op.addLabelNames as string[] | undefined) ?? [])
					.map((name) => resolveLabelName(name, labelMap))
					.filter(Boolean) as string[],
				removeLabelIds: ((op.removeLabelNames as string[] | undefined) ?? [])
					.map((name) => resolveLabelName(name, labelMap))
					.filter(Boolean) as string[],
			}));

			const results = await batchModifyMessages(config, idOps);
			const totalSucceeded = results.reduce(
				(sum, r) => sum + r.succeeded.length,
				0,
			);
			const totalFailed = results.reduce((sum, r) => sum + r.failed.length, 0);

			if (totalSucceeded > 0) {
				const parts: string[] = [];
				for (const op of operations) {
					const ids = (op.messageIds as string[] | undefined) ?? [];
					const actionParts: string[] = [];
					const add = (op.addLabelNames as string[] | undefined) ?? [];
					const remove = (op.removeLabelNames as string[] | undefined) ?? [];
					if (add.length) actionParts.push(`+${add.join(",")}`);
					if (remove.length) actionParts.push(`-${remove.join(",")}`);
					parts.push(`${actionParts.join(" ")} on ${ids.length} msg(s)`);
				}
				appliedActions.push(
					`Batch: ${parts.join("; ")} — ${totalSucceeded} succeeded${totalFailed > 0 ? `, ${totalFailed} failed` : ""}`,
				);
			}

			return withTokenPatch(
				{
					totalSucceeded,
					totalFailed,
					results: results.map((r) => ({
						succeeded: r.succeeded.length,
						failed: r.failed.length,
						addLabelIds: r.addLabelIds,
						removeLabelIds: r.removeLabelIds,
					})),
				},
				appliedActions,
			);
		}

		case "archiveEmailById": {
			const messageId = String(input.messageId ?? "");
			if (dryRun) {
				const msg = `[DRY RUN] Would archive message "${messageId}"`;
				appliedActions.push(msg);
				return withTokenPatch({ dryRun: true, message: msg }, appliedActions);
			}
			await archiveEmail(config, messageId);
			const message = await oneLineForMessageId(
				config,
				messageId,
				(subj) => `Archived "${subj}".`,
				`Archived message ${messageId.length > 18 ? `${messageId.slice(0, 12)}…` : messageId}.`,
			);
			appliedActions.push(message);
			return withTokenPatch(
				{ success: true, messageId, message },
				appliedActions,
			);
		}

		case "markAsReadById": {
			const messageId = String(input.messageId ?? "");
			if (dryRun) {
				const msg = `[DRY RUN] Would mark message "${messageId}" as read`;
				appliedActions.push(msg);
				return withTokenPatch({ dryRun: true, message: msg }, appliedActions);
			}
			await markEmailAsRead(config, messageId);
			const message = await oneLineForMessageId(
				config,
				messageId,
				(subj) => `Marked as read: "${subj}".`,
				`Marked as read: ${messageId.length > 18 ? `${messageId.slice(0, 12)}…` : messageId}.`,
			);
			appliedActions.push(message);
			return withTokenPatch(
				{ success: true, messageId, message },
				appliedActions,
			);
		}

		case "applyMultipleLabelsByMessageId": {
			const messageId = String(input.messageId ?? "");
			const labelNames = Array.isArray(input.labelNames)
				? input.labelNames.map(String)
				: [];
			if (dryRun) {
				const msg = `[DRY RUN] Would apply labels [${labelNames.join(", ")}] to "${messageId}"`;
				appliedActions.push(msg);
				return withTokenPatch({ dryRun: true, message: msg }, appliedActions);
			}
			const labelMap = await ensureLabels(config, labelNames);
			const labelIds = labelNames
				.map((name) => labelMap[name.toLowerCase()])
				.filter(Boolean) as string[];
			if (labelIds.length === 0) {
				return withTokenPatch({ error: "Failed to resolve any label IDs" });
			}
			await applyLabels(config, messageId, labelIds);
			const labelPart = labelNames.join(", ");
			const message = await oneLineForMessageId(
				config,
				messageId,
				(subj) => `Applied [${labelPart}] to "${subj}".`,
				`Applied [${labelPart}] to message ${messageId.length > 18 ? `${messageId.slice(0, 12)}…` : messageId}.`,
			);
			appliedActions.push(message);
			return withTokenPatch(
				{ success: true, messageId, labelNames, labelIds, message },
				appliedActions,
			);
		}

		case "listLabels": {
			if (dryRun) {
				return withTokenPatch({
					dryRun: true,
					message: "Would list all Gmail labels",
				});
			}
			const labelMap = await ensureLabels(config, []);
			const labels = Object.entries(labelMap).map(([name, id]) => ({
				name,
				id,
			}));
			return withTokenPatch({ labels });
		}

		case "createDraft": {
			const to = Array.isArray(input.to) ? input.to.map(String) : [];
			const cc = Array.isArray(input.cc) ? input.cc.map(String) : undefined;
			const bcc = Array.isArray(input.bcc) ? input.bcc.map(String) : undefined;
			const subject = String(input.subject ?? "");
			const body = String(input.body ?? "");
			if (dryRun) {
				const msg = `[DRY RUN] Would create draft to [${to.join(", ")}] subject "${truncateForLine(subject, 60)}"`;
				appliedActions.push(msg);
				return withTokenPatch({ dryRun: true, message: msg }, appliedActions);
			}
			const result = await createDraft(config, { to, cc, bcc, subject, body });
			const msg = `Created draft to [${to.join(", ")}] subject "${truncateForLine(subject, 60)}"`;
			appliedActions.push(msg);
			return withTokenPatch(
				{
					success: true,
					draftId: result.draftId,
					messageId: result.messageId,
					message: msg,
				},
				appliedActions,
			);
		}

		case "getRecentEmails": {
			if (dryRun) {
				return withTokenPatch({
					dryRun: true,
					message: "Would fetch recent emails",
				});
			}
			const maxResults =
				typeof input.maxResults === "number" ? input.maxResults : 5;
			const emails = await fetchUnreadInbox(config, maxResults);
			return withTokenPatch({
				emails: emails.map((e: GmailMessage) => ({
					from: e.from,
					subject: e.subject,
					date: e.date,
					snippet: e.snippet.slice(0, 100),
				})),
			});
		}

		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}

function withTokenPatch(
	result: unknown,
	appliedActions?: string[],
): {
	result: unknown;
	appliedActions?: string[];
	config?: Record<string, unknown>;
} {
	const patch = consumeTokenRefreshPatch();
	return {
		result,
		...(appliedActions?.length ? { appliedActions } : {}),
		...(patch ? { config: patch } : {}),
	};
}
