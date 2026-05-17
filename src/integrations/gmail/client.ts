import { google } from "googleapis";
import {
	getGmailCredentials,
	readConfig,
	writeConfig,
} from "../../config/index";
import { type RateLimitConfig, withRateLimit, withRetry } from "../rate-limit";

interface GmailIntegrationTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

function getAuthenticatedGmailClient() {
	const config = readConfig();
	const integrationState = config.integrations.gmail;
	const tokens = isGmailIntegrationTokens(integrationState)
		? integrationState
		: null;
	if (!tokens) {
		throw new Error("Gmail is not connected. Run `toby connect gmail` first.");
	}

	const credentials = getGmailCredentials();
	const oauth2Client = new google.auth.OAuth2(
		credentials.clientId,
		credentials.clientSecret,
	);

	oauth2Client.setCredentials({
		access_token: tokens.accessToken,
		refresh_token: tokens.refreshToken,
		expiry_date: tokens.expiresAt,
	});

	oauth2Client.on("tokens", (newTokens) => {
		if (newTokens.access_token) {
			const cfg = readConfig();
			if (isGmailIntegrationTokens(cfg.integrations.gmail)) {
				cfg.integrations.gmail.accessToken = newTokens.access_token;
				cfg.integrations.gmail.expiresAt =
					newTokens.expiry_date ?? Date.now() + 3600_000;
				writeConfig(cfg);
			}
		}
	});

	return oauth2Client;
}

function isGmailIntegrationTokens(
	value: unknown,
): value is GmailIntegrationTokens {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as {
		accessToken?: unknown;
		refreshToken?: unknown;
		expiresAt?: unknown;
	};
	const accessToken = candidate.accessToken;
	const refreshToken = candidate.refreshToken;
	const expiresAt = candidate.expiresAt;
	if (
		typeof accessToken !== "string" ||
		typeof refreshToken !== "string" ||
		typeof expiresAt !== "number"
	) {
		return false;
	}

	return true;
}

export interface GmailMessage {
	id: string;
	threadId: string;
	from: string;
	subject: string;
	date: string;
	snippet: string;
}

// Rate-limit configs for Gmail API.
// Per-user limit: 15 000 quota units / min ≈ 250 / sec.
// Concurrent cap: 50 parallel requests per mailbox.
const GMAIL_READ_LIMIT: RateLimitConfig = {
	maxConcurrent: 10,
	minDelayMs: 50,
};
const GMAIL_MUTATE_LIMIT: RateLimitConfig = {
	maxConcurrent: 5,
	minDelayMs: 100,
};

/** Maximum message IDs per batchModify call (Gmail API limit). */
const BATCH_MODIFY_MAX_IDS = 1000;

/** One page of message ids from Gmail list (no per-message fetches). */
interface InboxListPage {
	readonly messageSummaries: ReadonlyArray<{
		readonly id: string;
		readonly threadId: string;
	}>;
	readonly nextPageToken?: string;
	readonly resultSizeEstimate?: number;
	readonly pageSize: number;
}

async function fetchOneMessageMetadata(
	gmail: ReturnType<typeof google.gmail>,
	messageId: string,
): Promise<GmailMessage | null> {
	const full = await gmail.users.messages.get({
		userId: "me",
		id: messageId,
		format: "metadata",
		metadataHeaders: ["From", "Subject", "Date"],
	});

	const headers = full.data.payload?.headers ?? [];
	const getHeader = (name: string) =>
		headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ??
		"";

	return {
		id: messageId,
		threadId: full.data.threadId ?? "",
		from: getHeader("From"),
		subject: getHeader("Subject"),
		date: getHeader("Date"),
		snippet: full.data.snippet ?? "",
	};
}

/**
 * List unread messages in the inbox (ids + thread ids only). Uses a single
 * messages.list call — use for counts / pagination without loading bodies.
 */
export async function listInboxUnreadPage(
	maxResults = 50,
	pageToken?: string,
): Promise<InboxListPage> {
	return listInboxPage(maxResults, pageToken, {
		labelIds: ["INBOX", "UNREAD"],
	});
}

/**
 * List messages (ids + thread ids only) using a single messages.list call.
 * By default callers should include INBOX in labelIds when they mean "inbox".
 */
export async function listInboxPage(
	maxResults = 50,
	pageToken?: string,
	options?: {
		readonly labelIds?: readonly string[];
		readonly query?: string;
	},
): Promise<InboxListPage> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });
	const capped = Math.min(Math.max(1, maxResults), 500);

	const listRes = await gmail.users.messages.list({
		userId: "me",
		labelIds: options?.labelIds as string[] | undefined,
		q: options?.query?.trim() || undefined,
		maxResults: capped,
		pageToken,
	});

	const messages = listRes.data.messages ?? [];
	const messageSummaries = messages
		.filter(
			(m): m is { id: string; threadId?: string } => typeof m.id === "string",
		)
		.map((m) => ({
			id: m.id,
			threadId: m.threadId ?? "",
		}));

	return {
		messageSummaries,
		nextPageToken: listRes.data.nextPageToken ?? undefined,
		resultSizeEstimate: listRes.data.resultSizeEstimate ?? undefined,
		pageSize: messageSummaries.length,
	};
}

/** Metadata headers + snippet for specific message ids (bounded, rate-limited batch). */
export async function fetchUnreadMetadataByMessageIds(
	ids: readonly string[],
	maxParallel = 25,
): Promise<GmailMessage[]> {
	const unique = [...new Set(ids)].filter(Boolean).slice(0, maxParallel);
	if (unique.length === 0) {
		return [];
	}

	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	const results = await Promise.all(
		unique.map((id) =>
			withRateLimit(GMAIL_READ_LIMIT, () =>
				withRetry(() => fetchOneMessageMetadata(gmail, id)),
			),
		),
	);

	return results.filter((message): message is GmailMessage => message !== null);
}

export async function fetchUnreadInbox(
	maxResults = 20,
): Promise<GmailMessage[]> {
	const page = await listInboxUnreadPage(maxResults);
	if (page.messageSummaries.length === 0) {
		return [];
	}

	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	const results = await Promise.all(
		page.messageSummaries.map((m) =>
			withRateLimit(GMAIL_READ_LIMIT, () =>
				withRetry(() => fetchOneMessageMetadata(gmail, m.id)),
			),
		),
	);

	return results.filter((message): message is GmailMessage => message !== null);
}

export async function ensureLabels(
	labelNames: string[],
): Promise<Record<string, string>> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	const existing = await withRetry(() =>
		gmail.users.labels.list({ userId: "me" }),
	);
	const labelMap: Record<string, string> = {};
	for (const label of existing.data.labels ?? []) {
		if (label.name && label.id) {
			labelMap[label.name.toLowerCase()] = label.id;
		}
	}

	for (const name of labelNames) {
		const key = name.toLowerCase();
		if (!labelMap[key]) {
			const created = await withRetry(() =>
				gmail.users.labels.create({
					userId: "me",
					requestBody: {
						name,
						labelListVisibility: "labelShow",
						messageListVisibility: "show",
					},
				}),
			);
			if (created.data.id) {
				labelMap[key] = created.data.id;
			}
		}
	}

	return labelMap;
}

export async function applyLabels(
	messageId: string,
	labelIds: string[],
): Promise<void> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	await withRetry(() =>
		gmail.users.messages.modify({
			userId: "me",
			id: messageId,
			requestBody: {
				addLabelIds: labelIds,
			},
		}),
	);
}

export async function markEmailAsRead(messageId: string): Promise<void> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	await withRetry(() =>
		gmail.users.messages.modify({
			userId: "me",
			id: messageId,
			requestBody: { removeLabelIds: ["UNREAD"] },
		}),
	);
}

export async function archiveEmail(messageId: string): Promise<void> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	await withRetry(() =>
		gmail.users.messages.modify({
			userId: "me",
			id: messageId,
			requestBody: { removeLabelIds: ["INBOX"] },
		}),
	);
}

/**
 * Result of a single operation within a batchModifyMessages call.
 */
export interface BatchModifyOperationResult {
	/** The operation that was executed (label names resolved to IDs). */
	readonly addLabelIds: string[];
	readonly removeLabelIds: string[];
	/** Message IDs that were successfully modified. */
	readonly succeeded: string[];
	/** Message IDs that failed (e.g. not found). */
	readonly failed: string[];
}

/**
 * Batch-modify labels on many messages at once using the Gmail batchModify API.
 *
 * Each operation specifies a set of messageIds and labels to add/remove.
 * Operations that share the same (addLabelIds, removeLabelIds) signature are
 * merged internally so fewer API calls are made.
 *
 * Each batchModify call costs 50 quota units (vs 5 per individual messages.modify),
 * but handles up to 1 000 IDs per call — dramatically cheaper per message.
 */
export async function batchModifyMessages(
	operations: ReadonlyArray<{
		readonly messageIds: readonly string[];
		readonly addLabelIds?: readonly string[];
		readonly removeLabelIds?: readonly string[];
	}>,
): Promise<BatchModifyOperationResult[]> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	// Merge operations that share the same (add, remove) label signature.
	const merged = mergeOperations(operations);

	const results: BatchModifyOperationResult[] = [];

	for (const op of merged) {
		const idChunks = chunkArray(
			[...new Set(op.messageIds)].filter(Boolean),
			BATCH_MODIFY_MAX_IDS,
		);

		for (const chunk of idChunks) {
			try {
				await withRateLimit(GMAIL_MUTATE_LIMIT, () =>
					withRetry(() =>
						gmail.users.messages.batchModify({
							userId: "me",
							requestBody: {
								ids: chunk,
								addLabelIds:
									op.addLabelIds.length > 0 ? [...op.addLabelIds] : undefined,
								removeLabelIds:
									op.removeLabelIds.length > 0
										? [...op.removeLabelIds]
										: undefined,
							},
						}),
					),
				);
				results.push({
					addLabelIds: [...op.addLabelIds],
					removeLabelIds: [...op.removeLabelIds],
					succeeded: chunk,
					failed: [],
				});
			} catch {
				// On failure, report all IDs in this chunk as failed.
				results.push({
					addLabelIds: [...op.addLabelIds],
					removeLabelIds: [...op.removeLabelIds],
					succeeded: [],
					failed: chunk,
				});
			}
		}
	}

	return results;
}

/** Group operations that share the same add/remove label signature and merge their IDs. */
function mergeOperations(
	operations: ReadonlyArray<{
		readonly messageIds: readonly string[];
		readonly addLabelIds?: readonly string[];
		readonly removeLabelIds?: readonly string[];
	}>,
): Array<{
	messageIds: string[];
	addLabelIds: string[];
	removeLabelIds: string[];
}> {
	const map = new Map<
		string,
		{ messageIds: Set<string>; addLabelIds: string[]; removeLabelIds: string[] }
	>();

	for (const op of operations) {
		const add = [...(op.addLabelIds ?? [])].sort();
		const remove = [...(op.removeLabelIds ?? [])].sort();
		const key = `+${add.join(",")}|-${remove.join(",")}`;

		let entry = map.get(key);
		if (!entry) {
			entry = {
				messageIds: new Set(),
				addLabelIds: add,
				removeLabelIds: remove,
			};
			map.set(key, entry);
		}
		for (const id of op.messageIds) {
			entry.messageIds.add(id);
		}
	}

	return [...map.values()].map((e) => ({
		messageIds: [...e.messageIds],
		addLabelIds: e.addLabelIds,
		removeLabelIds: e.removeLabelIds,
	}));
}

function chunkArray<T>(arr: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		chunks.push(arr.slice(i, i + size));
	}
	return chunks;
}

export async function createDraft(options: {
	to: string[];
	cc?: string[];
	bcc?: string[];
	subject: string;
	body: string;
}): Promise<{ draftId: string; messageId: string }> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	const lines: string[] = [];
	lines.push(`To: ${options.to.join(", ")}`);
	if (options.cc?.length) {
		lines.push(`Cc: ${options.cc.join(", ")}`);
	}
	if (options.bcc?.length) {
		lines.push(`Bcc: ${options.bcc.join(", ")}`);
	}
	lines.push(
		`Subject: =?utf-8?B?${Buffer.from(options.subject).toString("base64")}?=`,
	);
	lines.push("Content-Type: text/plain; charset=utf-8");
	lines.push("MIME-Version: 1.0");
	lines.push("");
	lines.push(options.body);

	const raw = Buffer.from(lines.join("\r\n"))
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	const draft = await withRateLimit(GMAIL_MUTATE_LIMIT, () =>
		withRetry(() =>
			gmail.users.drafts.create({
				userId: "me",
				requestBody: {
					message: { raw },
				},
			}),
		),
	);

	const draftId = draft.data.id;
	const messageId = draft.data.message?.id;
	if (!draftId || !messageId) {
		throw new Error("Draft creation succeeded but returned incomplete data.");
	}

	return { draftId, messageId };
}

export async function testGmailConnection(): Promise<void> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	await gmail.users.getProfile({ userId: "me" });
}

export async function getGmailGrantedScopes(): Promise<string[]> {
	const auth = getAuthenticatedGmailClient();
	const accessTokenResult = await auth.getAccessToken();
	const accessToken =
		typeof accessTokenResult === "string"
			? accessTokenResult
			: accessTokenResult?.token;

	if (!accessToken) {
		throw new Error(
			"Could not obtain Gmail access token for scope validation.",
		);
	}

	const tokenInfo = await auth.getTokenInfo(accessToken);
	return tokenInfo.scopes ?? [];
}
