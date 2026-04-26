import { google } from "googleapis";
import {
	getGmailCredentials,
	readConfig,
	writeConfig,
} from "../../config/index";

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

/** Metadata headers + snippet for specific message ids (bounded batch). */
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
		unique.map((id) => fetchOneMessageMetadata(gmail, id)),
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
		page.messageSummaries.map((m) => fetchOneMessageMetadata(gmail, m.id)),
	);

	return results.filter((message): message is GmailMessage => message !== null);
}

export async function ensureLabels(
	labelNames: string[],
): Promise<Record<string, string>> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	const existing = await gmail.users.labels.list({ userId: "me" });
	const labelMap: Record<string, string> = {};
	for (const label of existing.data.labels ?? []) {
		if (label.name && label.id) {
			labelMap[label.name.toLowerCase()] = label.id;
		}
	}

	for (const name of labelNames) {
		const key = name.toLowerCase();
		if (!labelMap[key]) {
			const created = await gmail.users.labels.create({
				userId: "me",
				requestBody: {
					name,
					labelListVisibility: "labelShow",
					messageListVisibility: "show",
				},
			});
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

	await gmail.users.messages.modify({
		userId: "me",
		id: messageId,
		requestBody: {
			addLabelIds: labelIds,
		},
	});
}

export async function markEmailAsRead(messageId: string): Promise<void> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	await gmail.users.messages.modify({
		userId: "me",
		id: messageId,
		requestBody: { removeLabelIds: ["UNREAD"] },
	});
}

export async function archiveEmail(messageId: string): Promise<void> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	await gmail.users.messages.modify({
		userId: "me",
		id: messageId,
		requestBody: { removeLabelIds: ["INBOX"] },
	});
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
