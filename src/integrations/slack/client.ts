import {
	getSlackAuthMethod,
	getSlackCredentialField,
	getSlackCredentials,
	readCredentials,
} from "../../config/index";
import {
	buildMrkdwnSectionBlocks,
	stripMarkdownForPlainFallback,
	truncateSlackMarkdown,
} from "./slack-markdown";
import {
	isSlackAccessTokenFresh,
	refreshSlackOAuthAccessToken,
} from "./tokens";

export type SlackMessageFormat = "plain" | "markdown";

export interface SlackConversation {
	readonly id: string;
	readonly name: string;
	readonly kind: "channel" | "group" | "im" | "mpim";
	readonly isPrivate: boolean;
	readonly isMember: boolean;
}

export interface SlackUser {
	readonly id: string;
	readonly name: string;
	readonly realName: string;
	readonly displayName?: string;
	readonly email?: string;
	readonly isBot: boolean;
}

export interface SlackUserSearchResult {
	readonly users: SlackUser[];
	readonly emailLookup?: {
		readonly attempted: boolean;
		readonly found: boolean;
		readonly error?: string;
	};
}

export interface SlackMessageSearchHit {
	readonly channelId: string;
	readonly channelName?: string;
	readonly ts: string;
	readonly text: string;
	readonly user?: string;
	readonly permalink?: string;
}

interface SlackApiResponse {
	readonly ok: boolean;
	readonly error?: string;
}

const TOKEN_EXPIRED_ERRORS = new Set([
	"token_expired",
	"invalid_auth",
	"account_inactive",
]);

async function callSlackApi<T extends SlackApiResponse>(
	method: string,
	params: Record<string, string | number | boolean | undefined>,
	authToken: string,
): Promise<T> {
	const body = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined) continue;
		body.set(key, String(value));
	}

	const res = await fetch(`https://slack.com/api/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${authToken}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`Slack API ${method} failed (${res.status}): ${text || res.statusText}`,
		);
	}

	return (await res.json()) as T;
}

async function resolveSlackAuthToken(explicitToken?: string): Promise<string> {
	if (explicitToken) {
		return explicitToken;
	}
	const creds = getSlackCredentials();
	if (
		creds.authMethod === "oauth" &&
		!isSlackAccessTokenFresh(creds.oauthExpiresAt)
	) {
		return refreshSlackOAuthAccessToken();
	}
	return creds.botToken;
}

/** xoxb token for chat.postMessage — never the user OAuth token when both exist. */
export function resolveSlackPostToken(): string {
	const creds = readCredentials();
	const manualBot = getSlackCredentialField(creds, "botToken")?.trim();
	const oauthBot = getSlackCredentialField(creds, "oauthBotToken")?.trim();
	if (manualBot || oauthBot) {
		return manualBot || oauthBot || "";
	}
	return getSlackCredentials().botToken;
}

async function slackApiResult<T extends SlackApiResponse>(
	method: string,
	params: Record<string, string | number | boolean | undefined> = {},
	token?: string,
	retried = false,
): Promise<T> {
	let authToken = await resolveSlackAuthToken(token);
	let json = await callSlackApi<T>(method, params, authToken);

	if (
		!json.ok &&
		!retried &&
		!token &&
		TOKEN_EXPIRED_ERRORS.has(json.error ?? "") &&
		getSlackAuthMethod(readCredentials()) === "oauth"
	) {
		authToken = await refreshSlackOAuthAccessToken();
		json = await callSlackApi<T>(method, params, authToken);
	}

	return json;
}

async function slackApi<T extends SlackApiResponse>(
	method: string,
	params: Record<string, string | number | boolean | undefined> = {},
	token?: string,
	retried = false,
): Promise<T> {
	const json = await slackApiResult<T>(method, params, token, retried);
	if (!json.ok) {
		throw new Error(`Slack API ${method} error: ${json.error ?? "unknown"}`);
	}
	return json;
}

export async function testSlackConnection(token?: string): Promise<{
	readonly team?: string;
	readonly user?: string;
	readonly userId?: string;
	readonly teamId?: string;
}> {
	const json = await slackApi<{
		ok: boolean;
		error?: string;
		team?: string;
		user?: string;
		user_id?: string;
		team_id?: string;
	}>("auth.test", {}, token);
	return {
		team: json.team,
		user: json.user,
		userId: json.user_id,
		teamId: json.team_id,
	};
}

/**
 * Resolve the bot member id for inbound (@mention stripping, ignore own messages).
 * Always prefers auth.test with the inbound bot token over a configured hint.
 */
export async function resolveSlackBotUserId(
	botToken: string,
	configuredHint?: string,
): Promise<string> {
	const auth = await testSlackConnection(botToken);
	const fromAuth = auth.userId?.trim();
	if (fromAuth) {
		return fromAuth;
	}
	const hint = configuredHint?.trim();
	if (hint) {
		return hint;
	}
	throw new Error(
		"Could not resolve Slack bot user id from auth.test. Set slack.botUserId in credentials.",
	);
}

/** Bot token + app token for Socket Mode inbound (@mentions). */
export function getSlackInboundCredentials(): {
	readonly botToken: string;
	readonly appToken: string;
	readonly botUserId?: string;
} {
	const creds = readCredentials();
	const manualBot = getSlackCredentialField(creds, "botToken");
	const oauthBot = getSlackCredentialField(creds, "oauthBotToken");
	const botToken = manualBot || oauthBot;
	if (!botToken) {
		const userOAuth = getSlackCredentialField(creds, "oauthUserToken");
		if (userOAuth) {
			throw new Error(
				"Slack inbound needs a bot token (xoxb-...). `toby connect slack` only stores a user token (xoxp-...) for chat tools. In `toby configure` → Slack, paste Bot Token (OAuth & Permissions → install app → Bot User OAuth Token) and App Token (xapp-..., Socket Mode). Enable daemon/inbound to show Bot Token while Auth Method is OAuth.",
			);
		}
		throw new Error(
			"Slack inbound requires a bot token (xoxb-...) and an app token (xapp-...) for Socket Mode. Add both in `toby configure` → Slack (enable daemon/inbound to show Bot Token when using OAuth).",
		);
	}
	const appToken = getSlackCredentialField(creds, "appToken");
	if (!appToken) {
		throw new Error(
			"Slack inbound requires an app-level token (xapp-...) for Socket Mode (Basic Information → App-Level Tokens → connections:write). Add it in `toby configure` → Slack alongside the bot token (xoxb-...).",
		);
	}
	const botUserId = getSlackCredentialField(creds, "botUserId");
	return {
		botToken,
		appToken,
		botUserId,
	};
}

export async function listConversations(
	limit = 200,
): Promise<SlackConversation[]> {
	const types = ["public_channel", "private_channel", "mpim", "im"].join(",");
	const json = await slackApi<{
		ok: boolean;
		error?: string;
		channels?: Array<{
			id?: string;
			name?: string;
			is_private?: boolean;
			is_member?: boolean;
			is_im?: boolean;
			is_mpim?: boolean;
			user?: string;
		}>;
	}>("conversations.list", {
		types,
		exclude_archived: true,
		limit,
	});

	return (json.channels ?? [])
		.filter((c) => typeof c.id === "string")
		.map((c) => {
			const kind: SlackConversation["kind"] = c.is_im
				? "im"
				: c.is_mpim
					? "mpim"
					: c.is_private
						? "group"
						: "channel";
			return {
				id: c.id as string,
				name:
					c.name?.trim() ||
					(kind === "im" ? `dm:${c.user ?? c.id}` : (c.id as string)),
				kind,
				isPrivate: Boolean(c.is_private),
				isMember: Boolean(c.is_member),
			};
		});
}

type SlackMemberPayload = {
	readonly id?: string;
	readonly name?: string;
	readonly real_name?: string;
	readonly is_bot?: boolean;
	readonly deleted?: boolean;
	readonly profile?: {
		readonly real_name?: string;
		readonly display_name?: string;
		readonly email?: string;
	};
};

function mapSlackMember(member: SlackMemberPayload): SlackUser | null {
	if (typeof member.id !== "string" || member.deleted) {
		return null;
	}
	const name = member.name?.trim() || member.id;
	const profileReal = member.profile?.real_name?.trim();
	const profileDisplay = member.profile?.display_name?.trim();
	return {
		id: member.id,
		name,
		realName: member.real_name?.trim() || profileReal || name,
		displayName: profileDisplay || undefined,
		email: member.profile?.email?.trim() || undefined,
		isBot: Boolean(member.is_bot),
	};
}

function userMatchesQuery(user: SlackUser, queryLower: string): boolean {
	if (!queryLower) return true;
	const haystack = [
		user.name,
		user.realName,
		user.displayName,
		user.email,
		user.id,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return haystack.includes(queryLower);
}

function looksLikeEmail(query: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query.trim());
}

export async function listUsers(limit = 200): Promise<SlackUser[]> {
	const json = await slackApi<{
		ok: boolean;
		error?: string;
		members?: SlackMemberPayload[];
	}>("users.list", { limit });

	return (json.members ?? [])
		.map(mapSlackMember)
		.filter((u): u is SlackUser => u !== null);
}

async function listUsersPaginated(maxUsers = 1000): Promise<SlackUser[]> {
	const users: SlackUser[] = [];
	let cursor: string | undefined;

	while (users.length < maxUsers) {
		const json = await slackApi<{
			ok: boolean;
			error?: string;
			members?: SlackMemberPayload[];
			response_metadata?: { next_cursor?: string };
		}>("users.list", {
			limit: Math.min(200, maxUsers - users.length),
			cursor,
		});

		for (const member of json.members ?? []) {
			const mapped = mapSlackMember(member);
			if (mapped) users.push(mapped);
			if (users.length >= maxUsers) break;
		}

		const next = json.response_metadata?.next_cursor?.trim();
		if (!next) break;
		cursor = next;
	}

	return users;
}

export async function lookupUserByEmail(
	email: string,
): Promise<SlackUser | null> {
	const creds = getSlackCredentials();
	const body = new URLSearchParams({ email: email.trim() });
	const res = await fetch("https://slack.com/api/users.lookupByEmail", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${creds.botToken}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`Slack API users.lookupByEmail failed (${res.status}): ${text || res.statusText}`,
		);
	}

	const json = (await res.json()) as {
		ok: boolean;
		error?: string;
		user?: SlackMemberPayload;
	};
	if (!json.ok) {
		if (json.error === "users_not_found") {
			return null;
		}
		throw new Error(
			`Slack API users.lookupByEmail error: ${json.error ?? "unknown"}`,
		);
	}

	return json.user ? mapSlackMember(json.user) : null;
}

export async function searchSlackUsers(
	query: string,
	limit = 20,
): Promise<SlackUserSearchResult> {
	const q = query.trim();
	const qLower = q.toLowerCase();
	const byId = new Map<string, SlackUser>();
	let emailLookup: SlackUserSearchResult["emailLookup"];

	if (q && looksLikeEmail(q)) {
		emailLookup = { attempted: true, found: false };
		try {
			const byEmail = await lookupUserByEmail(q);
			if (byEmail && !byEmail.isBot) {
				byId.set(byEmail.id, byEmail);
				emailLookup = { attempted: true, found: true };
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			emailLookup = { attempted: true, found: false, error: message };
		}
	}

	if (q) {
		const roster = await listUsersPaginated(1000);
		for (const user of roster) {
			if (user.isBot) continue;
			if (userMatchesQuery(user, qLower)) {
				byId.set(user.id, user);
			}
			if (byId.size >= limit) break;
		}
	} else {
		const sample = await listUsers(Math.min(limit, 200));
		for (const user of sample.filter((u) => !u.isBot).slice(0, limit)) {
			byId.set(user.id, user);
		}
	}

	return {
		users: [...byId.values()].slice(0, limit),
		...(emailLookup ? { emailLookup } : {}),
	};
}

export async function searchConversations(
	query: string,
	limit = 30,
): Promise<{
	readonly channels: SlackConversation[];
	readonly users: SlackUser[];
}> {
	const q = query.trim().toLowerCase();
	const [channels, users] = await Promise.all([
		listConversations(500),
		listUsers(500),
	]);

	const channelMatches = channels
		.filter((c) => {
			if (!q) return true;
			return (
				c.name.toLowerCase().includes(q) ||
				c.id.toLowerCase().includes(q) ||
				(c.kind === "im" && c.name.toLowerCase().includes(q))
			);
		})
		.slice(0, limit);

	const userMatches = users
		.filter((u) => {
			if (u.isBot) return false;
			return userMatchesQuery(u, q);
		})
		.slice(0, limit);

	return { channels: channelMatches, users: userMatches };
}

export async function resolveChannelId(channelOrUser: string): Promise<string> {
	const target = channelOrUser.trim();
	if (!target) {
		throw new Error("Channel or user target is required.");
	}
	if (/^[CGD][A-Z0-9]+$/i.test(target)) {
		return target;
	}

	const normalized = target.replace(/^#/, "").toLowerCase();
	const conversations = await listConversations(500);
	const byName = conversations.find((c) => c.name.toLowerCase() === normalized);
	if (byName) return byName.id;

	const users = await listUsers(500);
	const byUser =
		users.find((u) => u.name.toLowerCase() === normalized) ??
		users.find((u) => u.realName.toLowerCase() === normalized) ??
		users.find((u) => u.displayName?.toLowerCase() === normalized) ??
		users.find((u) => u.email?.toLowerCase() === normalized);
	if (byUser) {
		const opened = await slackApi<{
			ok: boolean;
			error?: string;
			channel?: { id?: string };
		}>("conversations.open", { users: byUser.id });
		if (!opened.channel?.id) {
			throw new Error(`Could not open DM with user "${byUser.name}".`);
		}
		return opened.channel.id;
	}

	throw new Error(
		`Could not resolve Slack channel or user "${channelOrUser}". Use searchChannels first or pass a channel ID.`,
	);
}

type ChatPostMessageResponse = {
	ok: boolean;
	error?: string;
	channel?: string;
	ts?: string;
};

async function chatPostMessage(
	channelId: string,
	fields: Record<string, string | undefined>,
	token: string,
): Promise<{ readonly channel: string; readonly ts: string }> {
	const json = await slackApi<ChatPostMessageResponse>(
		"chat.postMessage",
		{ channel: channelId, ...fields },
		token,
	);
	if (!json.ok) {
		throw new Error(`Slack chat.postMessage error: ${json.error ?? "unknown"}`);
	}
	if (!json.ts) {
		throw new Error(
			"Slack chat.postMessage did not return a message timestamp.",
		);
	}
	return { channel: json.channel ?? channelId, ts: json.ts };
}

async function tryChatPostMessage(
	channelId: string,
	fields: Record<string, string | undefined>,
	token: string,
): Promise<ChatPostMessageResponse> {
	return slackApiResult<ChatPostMessageResponse>(
		"chat.postMessage",
		{ channel: channelId, ...fields },
		token,
	);
}

async function postSlackMessageAsMrkdwnBlocks(
	channelId: string,
	text: string,
	threadTs: string | undefined,
	token: string,
): Promise<{ readonly channel: string; readonly ts: string }> {
	const plain = stripMarkdownForPlainFallback(text).slice(0, 4000);
	return chatPostMessage(
		channelId,
		{
			text: plain,
			thread_ts: threadTs,
			blocks: buildMrkdwnSectionBlocks(text),
		},
		token,
	);
}

export async function postSlackMessage(params: {
	readonly channel: string;
	readonly text: string;
	readonly threadTs?: string;
	readonly token?: string;
	/** `markdown` sends Block Kit `mrkdwn` sections (GFM-ish conversion via `markdownToMrkdwn`); falls back to Slack `markdown_text` if blocks fail. `plain` sends unformatted top-level text only. */
	readonly format?: SlackMessageFormat;
}): Promise<{ readonly channel: string; readonly ts: string }> {
	const channelId = await resolveChannelId(params.channel);
	const postToken = params.token?.trim() || resolveSlackPostToken();
	const format = params.format ?? "markdown";

	if (format === "plain") {
		return chatPostMessage(
			channelId,
			{ text: params.text, thread_ts: params.threadTs },
			postToken,
		);
	}

	try {
		return await postSlackMessageAsMrkdwnBlocks(
			channelId,
			params.text,
			params.threadTs,
			postToken,
		);
	} catch (blocksError) {
		const markdown = truncateSlackMarkdown(params.text);
		const markdownResult = await tryChatPostMessage(
			channelId,
			{ markdown_text: markdown, thread_ts: params.threadTs },
			postToken,
		);
		if (markdownResult.ok && markdownResult.ts) {
			return {
				channel: markdownResult.channel ?? channelId,
				ts: markdownResult.ts,
			};
		}
		const blocksMsg =
			blocksError instanceof Error ? blocksError.message : String(blocksError);
		if (markdownResult.error) {
			throw new Error(
				`${blocksMsg} (markdown_text fallback failed: ${markdownResult.error})`,
			);
		}
		throw blocksError instanceof Error ? blocksError : new Error(blocksMsg);
	}
}

export async function searchSlackMessages(
	query: string,
	limit = 20,
): Promise<SlackMessageSearchHit[]> {
	const creds = getSlackCredentials();
	const token = creds.oauthUserToken ?? creds.botToken;
	const json = await slackApi<{
		ok: boolean;
		error?: string;
		messages?: {
			matches?: Array<{
				channel?: { id?: string; name?: string };
				ts?: string;
				text?: string;
				user?: string;
				permalink?: string;
			}>;
		};
	}>(
		"search.messages",
		{
			query,
			count: limit,
			sort: "timestamp",
			sort_dir: "desc",
		},
		token,
	);

	return (json.messages?.matches ?? [])
		.filter((m) => typeof m.ts === "string")
		.map((m) => ({
			channelId: m.channel?.id ?? "",
			channelName: m.channel?.name,
			ts: m.ts as string,
			text: m.text?.trim() ?? "",
			user: m.user,
			permalink: m.permalink,
		}));
}
