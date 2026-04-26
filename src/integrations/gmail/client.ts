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

export async function fetchUnreadInbox(
	maxResults = 20,
): Promise<GmailMessage[]> {
	const auth = getAuthenticatedGmailClient();
	const gmail = google.gmail({ version: "v1", auth });

	const listRes = await gmail.users.messages.list({
		userId: "me",
		labelIds: ["INBOX", "UNREAD"],
		maxResults,
	});

	const messages = listRes.data.messages ?? [];
	if (messages.length === 0) return [];

	const results = await Promise.all(
		messages.map(async (msg) => {
			if (!msg.id) {
				return null;
			}

			const full = await gmail.users.messages.get({
				userId: "me",
				id: msg.id,
				format: "metadata",
				metadataHeaders: ["From", "Subject", "Date"],
			});

			const headers = full.data.payload?.headers ?? [];
			const getHeader = (name: string) =>
				headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
					?.value ?? "";

			return {
				id: msg.id,
				threadId: msg.threadId ?? "",
				from: getHeader("From"),
				subject: getHeader("Subject"),
				date: getHeader("Date"),
				snippet: full.data.snippet ?? "",
			};
		}),
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
