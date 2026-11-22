import {
	type SlackMessageSearchHit,
	resolveSlackSearchUserId,
	searchSlackMessages,
} from "./client";
import { cleanSlackText, slackAfterDate } from "./mentions";

type JsonRecord = Record<string, unknown>;

function activityOptions(since: string, limit: number) {
	if (
		!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(since) ||
		!Number.isFinite(Date.parse(since))
	)
		throw new Error("since must be an ISO 8601 timestamp with an offset.");
	if (!Number.isInteger(limit) || limit < 1)
		throw new Error("limit must be a positive integer.");
	return { cutoff: Date.parse(since), cap: Math.min(1000, limit) };
}

export function slackActivityThreadTs(hit: SlackMessageSearchHit): string {
	if (hit.threadTs) return hit.threadTs;
	try {
		return new URL(hit.permalink ?? "").searchParams.get("thread_ts") || hit.ts;
	} catch {
		return hit.ts;
	}
}

export function toSlackActivity(
	hits: readonly SlackMessageSearchHit[],
	selfId: string,
	since: string,
	limit = 200,
) {
	const { cutoff, cap } = activityOptions(since, limit);
	const seen = new Set<string>();
	const observations = [...hits]
		.sort((a, b) => Number(b.ts) - Number(a.ts))
		.flatMap((hit) => {
			const time = Number(hit.ts) * 1000;
			if (
				!hit.channelId ||
				!hit.ts ||
				!Number.isFinite(time) ||
				time < cutoff ||
				Math.abs(time) > 8.64e15
			)
				return [];
			const externalId = `${hit.channelId}:${hit.ts}`;
			if (seen.has(externalId)) return [];
			seen.add(externalId);
			const text = cleanSlackText(hit.text, selfId);
			const scope = hit.teamId ? { scope: hit.teamId } : {};
			const actors = [
				...(hit.user
					? [
							{
								role: "author",
								handle: hit.user,
								...scope,
								...(hit.username ? { name: hit.username.slice(0, 200) } : {}),
							},
						]
					: []),
				...[
					...new Set(
						[...hit.text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)].map(
							(m) => m[1],
						),
					),
				].map((handle) => ({ role: "mentioned", handle, ...scope })),
			].slice(0, 100);
			return [
				{
					externalId,
					kind: "chat.message",
					threadId: `${hit.channelId}:${slackActivityThreadTs(hit)}`,
					direction: hit.user === selfId ? "outbound" : "inbound",
					occurredAt: new Date(time).toISOString(),
					title: cleanSlackText(hit.text.split(/\r?\n/)[0] ?? "", selfId).slice(
						0,
						1000,
					),
					excerpt: text.slice(0, 2000),
					...(hit.permalink ? { url: hit.permalink } : {}),
					actors,
					facts: {
						isDm: hit.isDirect ?? hit.channelId.startsWith("D"),
						channelName: (hit.channelName ?? "").slice(0, 500),
					},
				},
			];
		})
		.slice(0, cap);
	return { observations, self: { handles: [selfId] } };
}

export async function fetchRecentSlackActivity(
	config: JsonRecord,
	since: string,
	limit = 200,
) {
	const { cap } = activityOptions(since, limit);
	const selfId = await resolveSlackSearchUserId(config);
	if (!selfId)
		throw new Error(
			"Slack activity needs a user token. Reconnect Slack with OAuth (`toby connect slack`).",
		);
	const after = slackAfterDate(new Date(since), 0);
	// Sequential searches also avoid competing OAuth refreshes on expired tokens.
	const hits: SlackMessageSearchHit[] = [];
	for (const query of [
		`<@${selfId}> after:${after}`,
		`is:dm after:${after}`,
		`from:<@${selfId}> after:${after}`,
	]) {
		hits.push(...(await searchSlackMessages(config, query, cap)));
	}
	return toSlackActivity(hits, selfId, since, cap);
}
