import { describe, expect, it } from "bun:test";
import {
	FEED_RECENT_ITEM_TTL_MS,
	nextRecentItems,
} from "@toby/core/feed/index";
import type { FeedContent, FeedItem } from "@toby/core/feed/types";

const NOW = new Date("2026-11-19T09:10:00Z");

function item(id: string): FeedItem {
	return {
		id,
		source: { category: "calendar", providerName: "applecalendar", itemId: id },
		tier: "today",
		title: id,
		reason: "r",
		actions: [],
	};
}

function content(ids: string[]): FeedContent {
	return {
		status: "ok",
		generatedAt: NOW.toISOString(),
		items: ids.map(item),
		sources: [],
	} as unknown as FeedContent;
}

describe("recently dropped Feed items", () => {
	it("keeps items a re-rank dropped so the app can still act on them", () => {
		const previous = {
			signature: "a",
			rankedAt: new Date(NOW.getTime() - 60_000).toISOString(),
			content: content(["keep", "dropped"]),
			recentItems: [
				{
					item: item("older"),
					seenAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
				},
				{
					item: item("expired"),
					seenAt: new Date(
						NOW.getTime() - FEED_RECENT_ITEM_TTL_MS - 1,
					).toISOString(),
				},
				{
					item: item("keep"),
					seenAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
				},
			],
		};
		const recent = nextRecentItems(previous, content(["keep", "new"]), NOW);
		expect(recent.map((r) => r.item.id)).toEqual(["dropped", "older"]);
	});

	it("starts empty without a previous ranking", () => {
		expect(nextRecentItems(null, content(["a"]), NOW)).toEqual([]);
	});
});
