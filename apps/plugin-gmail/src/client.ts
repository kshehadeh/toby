import { google } from "googleapis";
import { runOAuthFlow } from "./auth";
import { withRateLimit, withRetry } from "./rate-limit";

export type GmailConfig = {
	readonly clientId: string;
	readonly clientSecret: string;
	readonly oauthAccessToken?: string;
	readonly oauthRefreshToken?: string;
	readonly oauthExpiresAt?: string;
};

type TokenRefreshPatch = {
	readonly oauthAccessToken: string;
	readonly oauthRefreshToken: string;
	readonly oauthExpiresAt: string;
};

let lastTokenPatch: TokenRefreshPatch | undefined;

export function consumeTokenRefreshPatch(): TokenRefreshPatch | undefined {
	const patch = lastTokenPatch;
	lastTokenPatch = undefined;
	return patch;
}

export function parseGmailConfig(raw: Record<string, unknown>): GmailConfig {
	return {
		clientId: String(raw.clientId ?? "").trim(),
		clientSecret: String(raw.clientSecret ?? "").trim(),
		oauthAccessToken: String(raw.oauthAccessToken ?? "").trim() || undefined,
		oauthRefreshToken: String(raw.oauthRefreshToken ?? "").trim() || undefined,
		oauthExpiresAt: String(raw.oauthExpiresAt ?? "").trim() || undefined,
	};
}

export function normalizeConfig(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const parsed = parseGmailConfig(raw);
	return {
		clientId: parsed.clientId,
		clientSecret: parsed.clientSecret,
		oauthAccessToken: parsed.oauthAccessToken ?? "",
		oauthRefreshToken: parsed.oauthRefreshToken ?? "",
		oauthExpiresAt: parsed.oauthExpiresAt ?? "",
	};
}

export function hasGmailCredentials(config: Record<string, unknown>): boolean {
	const parsed = parseGmailConfig(config);
	return Boolean(parsed.clientId && parsed.clientSecret);
}

export function hasGmailOAuthTokens(config: Record<string, unknown>): boolean {
	const parsed = parseGmailConfig(config);
	return Boolean(parsed.oauthAccessToken && parsed.oauthRefreshToken);
}

export async function runOAuthConnect(
	config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const parsed = parseGmailConfig(config);
	if (!parsed.clientId || !parsed.clientSecret) {
		throw new Error(
			"Gmail requires clientId and clientSecret. Set them in `toby configure`.",
		);
	}

	const tokens = await runOAuthFlow({
		clientId: parsed.clientId,
		clientSecret: parsed.clientSecret,
	});

	return {
		oauthAccessToken: tokens.accessToken,
		oauthRefreshToken: tokens.refreshToken,
		oauthExpiresAt: new Date(tokens.expiresAt).toISOString(),
	};
}

function parseExpiresAtMs(expiresAt?: string): number {
	if (!expiresAt) return Date.now() + 3600_000;
	const parsed = Date.parse(expiresAt);
	return Number.isFinite(parsed) ? parsed : Date.now() + 3600_000;
}

function getAuthenticatedGmailClient(config: Record<string, unknown>) {
	const parsed = parseGmailConfig(config);
	if (!parsed.oauthAccessToken || !parsed.oauthRefreshToken) {
		throw new Error("Gmail is not connected. Run `toby connect gmail` first.");
	}
	if (!parsed.clientId || !parsed.clientSecret) {
		throw new Error(
			"Gmail credentials not found. Add clientId/clientSecret in `toby configure`.",
		);
	}

	const oauth2Client = new google.auth.OAuth2(
		parsed.clientId,
		parsed.clientSecret,
	);

	oauth2Client.setCredentials({
		access_token: parsed.oauthAccessToken,
		refresh_token: parsed.oauthRefreshToken,
		expiry_date: parseExpiresAtMs(parsed.oauthExpiresAt),
	});

	oauth2Client.on("tokens", (newTokens) => {
		if (newTokens.access_token) {
			lastTokenPatch = {
				oauthAccessToken: newTokens.access_token,
				oauthRefreshToken:
					parsed.oauthRefreshToken ?? newTokens.refresh_token ?? "",
				oauthExpiresAt: new Date(
					newTokens.expiry_date ?? Date.now() + 3600_000,
				).toISOString(),
			};
		}
	});

	return oauth2Client;
}

/** Maximum message ids per metadata batch fetch (Gmail tools + client). */
export const METADATA_BATCH_MAX = 100;

export interface GmailMessage {
	id: string;
	threadId: string;
	from: string;
	subject: string;
	date: string;
	snippet: string;
	labelIds: readonly string[];
}

const GMAIL_READ_LIMIT = { maxConcurrent: 10, minDelayMs: 50 };
const GMAIL_MUTATE_LIMIT = { maxConcurrent: 5, minDelayMs: 100 };
const BATCH_MODIFY_MAX_IDS = 1000;

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
		labelIds: full.data.labelIds ?? [],
	};
}

export async function listInboxUnreadPage(
	config: Record<string, unknown>,
	maxResults = 50,
	pageToken?: string,
): Promise<InboxListPage> {
	return listInboxPage(config, maxResults, pageToken, {
		labelIds: ["INBOX", "UNREAD"],
	});
}

export async function listInboxPage(
	config: Record<string, unknown>,
	maxResults = 50,
	pageToken?: string,
	options?: {
		readonly labelIds?: readonly string[];
		readonly query?: string;
	},
): Promise<InboxListPage> {
	const auth = getAuthenticatedGmailClient(config);
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

export async function fetchUnreadMetadataByMessageIds(
	config: Record<string, unknown>,
	ids: readonly string[],
	maxParallel = METADATA_BATCH_MAX,
): Promise<GmailMessage[]> {
	const cap = Math.min(Math.max(1, maxParallel), METADATA_BATCH_MAX);
	const unique = [...new Set(ids)].filter(Boolean).slice(0, cap);
	if (unique.length === 0) {
		return [];
	}

	const auth = getAuthenticatedGmailClient(config);
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
	config: Record<string, unknown>,
	maxResults = 20,
): Promise<GmailMessage[]> {
	const page = await listInboxUnreadPage(config, maxResults);
	if (page.messageSummaries.length === 0) {
		return [];
	}

	const auth = getAuthenticatedGmailClient(config);
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
	config: Record<string, unknown>,
	labelNames: string[],
): Promise<Record<string, string>> {
	const auth = getAuthenticatedGmailClient(config);
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
	config: Record<string, unknown>,
	messageId: string,
	labelIds: string[],
): Promise<void> {
	const auth = getAuthenticatedGmailClient(config);
	const gmail = google.gmail({ version: "v1", auth });

	await withRetry(() =>
		gmail.users.messages.modify({
			userId: "me",
			id: messageId,
			requestBody: { addLabelIds: labelIds },
		}),
	);
}

export async function markEmailAsRead(
	config: Record<string, unknown>,
	messageId: string,
): Promise<void> {
	const auth = getAuthenticatedGmailClient(config);
	const gmail = google.gmail({ version: "v1", auth });

	await withRetry(() =>
		gmail.users.messages.modify({
			userId: "me",
			id: messageId,
			requestBody: { removeLabelIds: ["UNREAD"] },
		}),
	);
}

export async function archiveEmail(
	config: Record<string, unknown>,
	messageId: string,
): Promise<void> {
	const auth = getAuthenticatedGmailClient(config);
	const gmail = google.gmail({ version: "v1", auth });

	await withRetry(() =>
		gmail.users.messages.modify({
			userId: "me",
			id: messageId,
			requestBody: { removeLabelIds: ["INBOX"] },
		}),
	);
}

export interface BatchModifyOperationResult {
	readonly addLabelIds: string[];
	readonly removeLabelIds: string[];
	readonly succeeded: string[];
	readonly failed: string[];
}

export async function batchModifyMessages(
	config: Record<string, unknown>,
	operations: ReadonlyArray<{
		readonly messageIds: readonly string[];
		readonly addLabelIds?: readonly string[];
		readonly removeLabelIds?: readonly string[];
	}>,
): Promise<BatchModifyOperationResult[]> {
	const auth = getAuthenticatedGmailClient(config);
	const gmail = google.gmail({ version: "v1", auth });
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

export async function createDraft(
	config: Record<string, unknown>,
	options: {
		to: string[];
		cc?: string[];
		bcc?: string[];
		subject: string;
		body: string;
	},
): Promise<{ draftId: string; messageId: string }> {
	const auth = getAuthenticatedGmailClient(config);
	const gmail = google.gmail({ version: "v1", auth });

	const lines: string[] = [];
	lines.push(`To: ${options.to.join(", ")}`);
	if (options.cc?.length) lines.push(`Cc: ${options.cc.join(", ")}`);
	if (options.bcc?.length) lines.push(`Bcc: ${options.bcc.join(", ")}`);
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
				requestBody: { message: { raw } },
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

export async function testGmailConnection(
	config: Record<string, unknown>,
): Promise<void> {
	const auth = getAuthenticatedGmailClient(config);
	const gmail = google.gmail({ version: "v1", auth });
	await gmail.users.getProfile({ userId: "me" });
}

export async function getGmailGrantedScopes(
	config: Record<string, unknown>,
): Promise<string[]> {
	const auth = getAuthenticatedGmailClient(config);
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
