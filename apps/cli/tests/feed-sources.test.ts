import { beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { getDashboardFeedStatePath } from "@toby/core/config/index";
import { STANDARD_TOOL_FOR_CATEGORY } from "@toby/core/dashboard/types";
import { allowedActionIds, resolveActions } from "@toby/core/feed/actions";
import { performFeedAction } from "@toby/core/feed/execute";
import {
	buildFeedPersonalization,
	formatPersonalizationForPrompt,
	memoryLines,
	personalizationSignature,
} from "@toby/core/feed/personalization";
import {
	type RawFeedCandidate,
	feedbackKeyFor,
	prefilterCandidates,
} from "@toby/core/feed/prefilter";
import { buildFeedSystemPrompt } from "@toby/core/feed/rank";
import {
	clearFeedStateCache,
	feedbackCounts,
	loadFeedState,
} from "@toby/core/feed/state";
import type { FeedCandidate, FeedItem } from "@toby/core/feed/types";
import type { MemoryItem } from "@toby/core/memory/types";
import { TOOL_DEFINITIONS as NEWS_TOOLS } from "../../plugin-news/src/tools";
import {
	cleanSlackText,
	mentionQueries,
	slackAfterDate,
	toMentionsSummary,
} from "../../plugin-slack/src/mentions";
import { TOOL_DEFINITIONS as SLACK_TOOLS } from "../../plugin-slack/src/tools";

const NOW = new Date("2026-11-17T15:00:00Z");
const HOUR = 60 * 60 * 1000;

function raw(partial: Partial<RawFeedCandidate>): RawFeedCandidate {
	return {
		id: `${partial.category ?? "chat"}:p:${partial.itemId ?? "1"}`,
		category: "chat",
		providerName: "slack",
		itemId: "1",
		title: "Hello",
		...partial,
	};
}

function memory(partial: Partial<MemoryItem>): MemoryItem {
	return {
		id: "m1",
		userId: "default",
		type: "fact",
		value: "Works at Acme on the payments team",
		confidence: 1,
		sensitivity: "normal",
		visibility: "usable_by_ai",
		sourceIds: [],
		createdAt: NOW.toISOString(),
		updatedAt: NOW.toISOString(),
		...partial,
	};
}

beforeEach(() => {
	clearFeedStateCache();
	fs.rmSync(getDashboardFeedStatePath(), { force: true });
});

describe("chat and news standard tools", () => {
	it("registers chat and news dashboard contracts", () => {
		expect(STANDARD_TOOL_FOR_CATEGORY.chat).toBe("chat.mentionsSummary");
		expect(STANDARD_TOOL_FOR_CATEGORY.news).toBe("news.headlinesSummary");
	});

	it("Slack and News tag a tool with the contract", () => {
		expect(
			SLACK_TOOLS.find(
				(t) =>
					(t as { standardTool?: string }).standardTool ===
					"chat.mentionsSummary",
			)?.name,
		).toBe("getMentionsSummary");
		expect(
			NEWS_TOOLS.find((t) => t.standardTool === "news.headlinesSummary")?.name,
		).toBe("getLatestSummary");
	});
});

describe("Slack mentions summary", () => {
	it("builds mention and DM queries from a day before the lookback", () => {
		const after = slackAfterDate(new Date(2026, 10, 17, 9), 2);
		expect(after).toBe("2026-11-14");
		expect(mentionQueries("U1", after)).toEqual({
			mentions: "<@U1> after:2026-11-14",
			direct: "is:dm after:2026-11-14",
		});
	});

	it("cleans Slack markup", () => {
		expect(
			cleanSlackText(
				"<@U1> can you check <#C9|deploys> and <https://x.dev|this>? cc <@U2|sam> <!here>",
				"U1",
			),
		).toBe("@you can you check #deploys and this? cc @sam @here");
	});

	it("maps hits newest first, drops own messages, and de-dupes", () => {
		const t1 = String(NOW.getTime() / 1000 - 600);
		const t2 = String(NOW.getTime() / 1000 - 60);
		const summary = toMentionsSummary(
			[
				{
					channelId: "C1",
					channelName: "eng",
					ts: t1,
					text: "<@U1> review?",
					user: "U2",
					username: "alex",
					permalink: "https://slack/p1",
				},
				{ channelId: "D1", ts: t2, text: "lunch?", user: "U3", isDirect: true },
				{ channelId: "C1", ts: t1, text: "<@U1> review?", user: "U2" },
				{ channelId: "C2", ts: t2, text: "mine", user: "U1" },
			],
			"U1",
			10,
			NOW,
		) as { count: number; items: Array<Record<string, string>> };
		expect(summary.count).toBe(2);
		expect(summary.items.map((i) => i.id)).toEqual([`D1:${t2}`, `C1:${t1}`]);
		expect(summary.items[0]?.subtitle).toBe("someone · Direct message");
		expect(summary.items[1]).toMatchObject({
			title: "@you review?",
			subtitle: "@alex · #eng",
			url: "https://slack/p1",
		});
	});
});

describe("chat and news in the pre-filter", () => {
	it("scores DMs and fresh questions above news, and drops stale items", () => {
		const out = prefilterCandidates(
			[
				raw({
					itemId: "dm",
					title: "Can you approve?",
					subtitle: "@alex · Direct message",
					timestamp: new Date(NOW.getTime() - HOUR).toISOString(),
				}),
				raw({
					itemId: "old",
					subtitle: "@sam · #eng",
					timestamp: new Date(NOW.getTime() - 4 * 24 * HOUR).toISOString(),
				}),
				raw({
					category: "news",
					providerName: "news",
					itemId: "n1",
					title: "Headline",
					timestamp: new Date(NOW.getTime() - HOUR).toISOString(),
				}),
				raw({
					category: "news",
					providerName: "news",
					itemId: "n-old",
					timestamp: new Date(NOW.getTime() - 2 * 24 * HOUR).toISOString(),
				}),
			],
			NOW,
		);
		expect(out.map((c) => c.itemId)).toEqual(["dm", "n1"]);
		expect(out[0]?.signals).toContain("direct message");
		expect(out[0]?.signals).toContain("asks a question");
		expect(out[1]?.signals).toContain("news headline");
	});

	it("caps news candidates", () => {
		const news = Array.from({ length: 10 }, (_, i) =>
			raw({ category: "news", providerName: "news", itemId: `n${i}` }),
		);
		expect(prefilterCandidates(news, NOW)).toHaveLength(6);
	});

	it("keys feedback by sender, channel, or section", () => {
		expect(
			feedbackKeyFor({
				category: "email",
				providerName: "email",
				subtitle: "Promo <Deals@Shop.com>",
			}),
		).toBe("email:email:deals@shop.com");
		expect(
			feedbackKeyFor({
				category: "chat",
				providerName: "slack",
				subtitle: "@alex · #random",
			}),
		).toBe("chat:slack:#random");
		expect(
			feedbackKeyFor({
				category: "chat",
				providerName: "slack",
				subtitle: "@alex · Direct message",
			}),
		).toBe("chat:slack:@alex");
		expect(feedbackKeyFor({ category: "news", providerName: "news" })).toBe(
			null,
		);
	});

	it("lowers sources the user marked not relevant", () => {
		const c = raw({ itemId: "r", subtitle: "@sam · #random" });
		const [base] = prefilterCandidates([c], NOW);
		const [once] = prefilterCandidates(
			[c],
			NOW,
			new Map([["chat:slack:#random", 1]]),
		);
		const [twice] = prefilterCandidates(
			[c],
			NOW,
			new Map([["chat:slack:#random", 3]]),
		);
		expect((base?.score ?? 0) - (once?.score ?? 0)).toBe(15);
		expect((base?.score ?? 0) - (twice?.score ?? 0)).toBe(30);
		expect(twice?.signals.at(-1)).toContain("marked 3 similar items");
	});
});

describe("chat and news actions", () => {
	const chat: FeedCandidate = {
		...raw({
			itemId: "C1:1",
			title: "Can you review?",
			subtitle: "@alex · #eng",
			url: "https://slack/p",
		}),
		signals: [],
		score: 0,
	};

	it("offers draft reply for chat and a briefing for news", () => {
		expect(allowedActionIds(chat)).toEqual(["chat.draftReply", "todo.add"]);
		expect(
			allowedActionIds({ ...chat, category: "news", providerName: "news" }),
		).toEqual(["news.discuss"]);
	});

	it("chat draft reply never posts, and every item can be marked not relevant", () => {
		const actions = resolveActions(chat, ["chat.draftReply"]);
		expect(actions.map((a) => a.id)).toEqual([
			"chat.draftReply",
			"open",
			"snooze",
			"notRelevant",
			"dismiss",
		]);
		expect(actions[0]?.prompt).toContain("Do not post it");
		expect(actions[0]?.prompt).toContain("https://slack/p");
	});
});

describe("not relevant feedback", () => {
	const feedItem: FeedItem = {
		id: "chat:slack:C1:1",
		source: { category: "chat", providerName: "slack", itemId: "C1:1" },
		tier: "fyi",
		title: "Standup moved",
		subtitle: "@sam · #random",
		reason: "r",
		actions: resolveActions(
			{
				...raw({ itemId: "C1:1", subtitle: "@sam · #random" }),
				signals: [],
				score: 0,
			},
			[],
		),
	};

	it("hides the item and records feedback keyed by its source", async () => {
		const outcome = await performFeedAction(
			{ itemId: feedItem.id, actionId: "notRelevant" },
			{ findItem: () => feedItem, now: () => NOW },
		);
		expect(outcome.ok).toBe(true);
		clearFeedStateCache();
		const state = loadFeedState(NOW);
		expect(state.items[feedItem.id]?.kind).toBe("dismissed");
		expect(state.feedback).toHaveLength(1);
		expect(feedbackCounts(state).get("chat:slack:#random")).toBe(1);
	});
});

describe("personalization", () => {
	it("uses AI-usable, non-sensitive, unexpired memories within budget", () => {
		const lines = memoryLines(
			[
				memory({ id: "a", subject: "work" }),
				memory({ id: "b", sensitivity: "sensitive", value: "secret" }),
				memory({ id: "c", visibility: "user_only" as never, value: "hidden" }),
				memory({
					id: "d",
					value: "expired",
					expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
				}),
			],
			NOW.getTime(),
		);
		expect(lines).toEqual(["fact (work): Works at Acme on the payments team"]);
		expect(memoryLines([memory({})], NOW.getTime(), 10)).toEqual([]);
	});

	it("feeds memories and recent not-relevant marks into the ranking prompt", () => {
		const p = buildFeedPersonalization(
			{
				items: {},
				notified: {},
				feedback: [
					{
						key: "news:news:hn",
						category: "news",
						title: "Crypto rally",
						subtitle: "Hacker News",
						at: NOW.toISOString(),
					},
				],
			},
			{ listMemories: () => [memory({})] },
		);
		const section = formatPersonalizationForPrompt(p);
		expect(section).toContain("Works at Acme");
		expect(section).toContain("[news] Crypto rally — Hacker News");
		const prompt = buildFeedSystemPrompt(
			{ name: "Home", instructions: "", promptMode: "add" } as never,
			NOW,
			p,
		);
		expect(prompt).toContain("Works at Acme");
		expect(prompt).toContain("News is context, not work");
		expect(personalizationSignature(p)).not.toBe(
			personalizationSignature({ memories: [], notRelevant: [] }),
		);
	});

	it("omits the section when there is nothing to personalize with", () => {
		expect(
			formatPersonalizationForPrompt({ memories: [], notRelevant: [] }),
		).toBe("");
	});
});
