import {
	getSlackAuthMethod,
	getSlackCredentials,
	readCredentials,
} from "../../config/index";
import {
	isSlackAccessTokenFresh,
	refreshSlackOAuthAccessToken,
} from "./tokens";

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

async function slackApi<T extends SlackApiResponse>(
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

	if (!json.ok) {
		throw new Error(`Slack API ${method} error: ${json.error ?? "unknown"}`);
	}
	return json;
}

export async function testSlackConnection(): Promise<{
	readonly team?: string;
	readonly user?: string;
}> {
	const json = await slackApi<{
		ok: boolean;
		error?: string;
		team?: string;
		user?: string;
	}>("auth.test");
	return { team: json.team, user: json.user };
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

export async function postSlackMessage(params: {
	readonly channel: string;
	readonly text: string;
	readonly threadTs?: string;
}): Promise<{ readonly channel: string; readonly ts: string }> {
	const channelId = await resolveChannelId(params.channel);
	const json = await slackApi<{
		ok: boolean;
		error?: string;
		channel?: string;
		ts?: string;
	}>("chat.postMessage", {
		channel: channelId,
		text: params.text,
		thread_ts: params.threadTs,
	});
	if (!json.ts) {
		throw new Error(
			"Slack chat.postMessage did not return a message timestamp.",
		);
	}
	return { channel: json.channel ?? channelId, ts: json.ts };
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
