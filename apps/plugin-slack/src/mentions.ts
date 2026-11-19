import {
	type SlackMessageSearchHit,
	resolveSlackSearchUserId,
	searchSlackMessages,
} from "./client";

type JsonRecord = Record<string, unknown>;

/** How far back The Feed looks for mentions and direct messages. */
export const MENTIONS_LOOKBACK_DAYS = 2;
const DEFAULT_LIMIT = 20;
const TITLE_MAX = 160;

/** Slack `after:` takes a date and is exclusive, so step one extra day back. */
export function slackAfterDate(now: Date, lookbackDays: number): string {
	const d = new Date(now);
	d.setDate(d.getDate() - lookbackDays - 1);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Search queries for messages that mention the user and direct messages to them. */
export function mentionQueries(
	userId: string,
	after: string,
): { mentions: string; direct: string } {
	return {
		mentions: `<@${userId}> after:${after}`,
		direct: `is:dm after:${after}`,
	};
}

/** Readable one-line message text: user mentions → @you / @someone, links unwrapped. */
export function cleanSlackText(text: string, selfId: string): string {
	return text
		.replace(
			/<@([A-Z0-9]+)(?:\|([^>]+))?>/g,
			(_, id: string, label?: string) =>
				id === selfId ? "@you" : `@${label ?? "someone"}`,
		)
		.replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
		.replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
		.replace(/<(https?:[^>]+)>/g, "$1")
		.replace(/<!(here|channel|everyone)>/g, "@$1")
		.replace(/\s+/g, " ")
		.trim();
}

function tsToIso(ts: string): string | undefined {
	const seconds = Number.parseFloat(ts);
	return Number.isFinite(seconds)
		? new Date(seconds * 1000).toISOString()
		: undefined;
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Map search hits into the dashboard summary shape (`chat.mentionsSummary`).
 * Drops the user's own messages, de-dupes hits found by both queries, and
 * returns newest first.
 */
export function toMentionsSummary(
	hits: readonly SlackMessageSearchHit[],
	selfId: string,
	limit: number,
	now: Date = new Date(),
): JsonRecord {
	const seen = new Set<string>();
	const items: JsonRecord[] = [];
	const sorted = [...hits].sort(
		(a, b) => Number.parseFloat(b.ts) - Number.parseFloat(a.ts),
	);
	for (const hit of sorted) {
		if (!hit.channelId || hit.user === selfId) continue;
		const id = `${hit.channelId}:${hit.ts}`;
		if (seen.has(id)) continue;
		seen.add(id);
		const text = cleanSlackText(hit.text, selfId);
		if (!text) continue;
		const from = hit.username ? `@${hit.username}` : "someone";
		const where = hit.isDirect
			? "Direct message"
			: hit.channelName
				? `#${hit.channelName}`
				: "Slack";
		const timestamp = tsToIso(hit.ts);
		items.push({
			id,
			title: truncate(text, TITLE_MAX),
			subtitle: `${from} · ${where}`,
			...(text.length > TITLE_MAX ? { detail: truncate(text, 600) } : {}),
			...(timestamp ? { timestamp } : {}),
			...(hit.isDirect ? { groupId: "direct" } : { groupId: "mentions" }),
			...(hit.permalink ? { url: hit.permalink } : {}),
		});
		if (items.length >= limit) break;
	}
	const direct = items.filter((i) => i.groupId === "direct").length;
	return {
		count: items.length,
		items,
		groups: [
			{ id: "mentions", label: "Mentions", count: items.length - direct },
			{ id: "direct", label: "Direct messages", count: direct },
		],
		generatedAt: now.toISOString(),
	};
}

/** Recent mentions of the user and direct messages to them. Needs a user token. */
export async function fetchMentionsSummary(
	config: JsonRecord,
	options: { readonly limit?: number; readonly now?: Date } = {},
): Promise<JsonRecord> {
	const now = options.now ?? new Date();
	const limit = Math.max(1, Math.min(50, options.limit ?? DEFAULT_LIMIT));
	const selfId = await resolveSlackSearchUserId(config);
	if (!selfId) {
		throw new Error(
			"Slack mentions need a user token. Reconnect Slack with OAuth (`toby connect slack`).",
		);
	}
	const queries = mentionQueries(
		selfId,
		slackAfterDate(now, MENTIONS_LOOKBACK_DAYS),
	);
	const results = await Promise.allSettled([
		searchSlackMessages(config, queries.mentions, limit),
		searchSlackMessages(config, queries.direct, limit),
	]);
	const hits = results.flatMap((r) =>
		r.status === "fulfilled" ? r.value : [],
	);
	const firstError = results.find((r) => r.status === "rejected");
	if (hits.length === 0 && firstError?.status === "rejected") {
		throw firstError.reason;
	}
	return toMentionsSummary(hits, selfId, limit, now);
}
