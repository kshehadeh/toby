import {
	clampLimit,
	fetchJson,
	fromDateToUnixSeconds,
	normalizeFromDate,
	numberField,
	stringField,
	stripHtml,
} from "./helpers";
import {
	type NewsArticle,
	NewsFailure,
	type NewsSearchParams,
	type NewsSearchResult,
} from "./types";

export const DEFAULT_HN_API_BASE = "https://hn.algolia.com/api/v1";

type HnHit = {
	objectID?: unknown;
	title?: unknown;
	story_title?: unknown;
	url?: unknown;
	author?: unknown;
	created_at?: unknown;
	points?: unknown;
	num_comments?: unknown;
	story_text?: unknown;
	_tags?: unknown;
};

type HnResponse = {
	hits?: unknown;
	nbHits?: unknown;
	message?: unknown;
};

export function resolveHnApiBase(): string {
	const override = process.env.TOBY_HN_API_BASE?.trim();
	const raw = override && override.length > 0 ? override : DEFAULT_HN_API_BASE;
	return raw.replace(/\/+$/, "");
}

export type HnFeed = "front_page" | "newest" | "ask_hn" | "show_hn" | "story";

export function normalizeHnFeed(
	value: unknown,
	mode: "latest" | "search",
): HnFeed {
	const raw = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/[_\s]+/g, "-");
	if (raw === "newest" || raw === "new") {
		return "newest";
	}
	if (raw === "ask-hn" || raw === "ask") {
		return "ask_hn";
	}
	if (raw === "show-hn" || raw === "show") {
		return "show_hn";
	}
	if (raw === "front-page") {
		return "front_page";
	}
	if (raw === "story" || raw === "stories") {
		return "story";
	}
	return mode === "search" ? "story" : "front_page";
}

export function parseHnArticles(body: unknown): {
	articles: NewsArticle[];
	total?: number;
} {
	const payload = (body ?? {}) as HnResponse;
	const rawHits = Array.isArray(payload.hits) ? payload.hits : [];
	const articles: NewsArticle[] = [];

	for (const item of rawHits) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			continue;
		}
		const hit = item as HnHit;
		const objectId = stringField(hit.objectID);
		const title = stringField(hit.title) || stringField(hit.story_title);
		if (!objectId || !title) {
			continue;
		}
		const discussionUrl = `https://news.ycombinator.com/item?id=${objectId}`;
		const url = stringField(hit.url) || discussionUrl;
		const tags = Array.isArray(hit._tags)
			? hit._tags.filter((tag): tag is string => typeof tag === "string")
			: [];
		const section = hnSectionLabel(tags);
		const storyText = stripHtml(stringField(hit.story_text));
		const score = numberField(hit.points);
		const commentCount = numberField(hit.num_comments);
		const summaryParts: string[] = [];
		if (typeof score === "number") {
			summaryParts.push(`${score} points`);
		}
		if (typeof commentCount === "number") {
			summaryParts.push(`${commentCount} comments`);
		}
		const summary =
			storyText || (summaryParts.length > 0 ? summaryParts.join(", ") : "");
		const byline = stringField(hit.author);

		articles.push({
			id: `hn:${objectId}`,
			source: "Hacker News",
			title,
			section,
			sectionId: hnSectionId(tags),
			publishedAt: stringField(hit.created_at),
			url,
			summary,
			...(byline ? { byline } : {}),
			discussionUrl,
			...(score !== undefined ? { score } : {}),
			...(commentCount !== undefined ? { commentCount } : {}),
		});
	}

	const total =
		typeof payload.nbHits === "number" && Number.isFinite(payload.nbHits)
			? payload.nbHits
			: undefined;
	return { articles, total };
}

function hnSectionLabel(tags: string[]): string {
	if (tags.includes("ask_hn")) return "Ask HN";
	if (tags.includes("show_hn")) return "Show HN";
	if (tags.includes("job")) return "HN Jobs";
	if (tags.includes("front_page")) return "Front page";
	return "Hacker News";
}

function hnSectionId(tags: string[]): string {
	if (tags.includes("ask_hn")) return "ask_hn";
	if (tags.includes("show_hn")) return "show_hn";
	if (tags.includes("job")) return "job";
	if (tags.includes("front_page")) return "front_page";
	return "hacker-news";
}

export function buildHnSearchUrl(params: {
	query?: string;
	feed: HnFeed;
	fromDate?: string;
	limit: number;
}): URL {
	const endpoint = params.feed === "newest" ? "search_by_date" : "search";
	const url = new URL(endpoint, `${resolveHnApiBase()}/`);
	url.searchParams.set("hitsPerPage", String(params.limit));
	url.searchParams.set("tags", hnTags(params.feed));
	if (params.query) {
		url.searchParams.set("query", params.query);
	}
	if (params.fromDate) {
		url.searchParams.set(
			"numericFilters",
			`created_at_i>${fromDateToUnixSeconds(params.fromDate)}`,
		);
	}
	return url;
}

function hnTags(feed: HnFeed): string {
	switch (feed) {
		case "front_page":
			return "front_page";
		case "ask_hn":
			return "ask_hn";
		case "show_hn":
			return "show_hn";
		case "newest":
		case "story":
			return "story";
	}
}

export async function hnSearch(
	params: NewsSearchParams,
	mode: "latest" | "search",
	fetchImpl: typeof fetch = fetch,
): Promise<NewsSearchResult> {
	const query = String(params.query ?? "").trim();
	if (mode === "search" && !query) {
		throw new NewsFailure("query is required.");
	}
	const fromDate = normalizeFromDate(params.fromDate);
	const limit = clampLimit(params.limit);
	const feed = normalizeHnFeed(params.section, mode);
	const url = buildHnSearchUrl({
		query: query || undefined,
		feed,
		fromDate,
		limit,
	});

	const { status, body } = await fetchJson(
		url,
		fetchImpl,
		"the Hacker News API",
	);
	if (status >= 400) {
		const message = stringField((body as HnResponse).message);
		throw new NewsFailure(
			message || `The Hacker News API request failed (HTTP ${status}).`,
		);
	}

	const parsed = parseHnArticles(body);
	return {
		source: "Hacker News",
		sources: ["Hacker News"],
		...(query ? { query } : {}),
		section: feed,
		...(fromDate ? { fromDate } : {}),
		count: parsed.articles.length,
		...(parsed.total !== undefined ? { total: parsed.total } : {}),
		articles: parsed.articles,
	};
}
