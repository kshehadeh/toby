import { describe, expect, it } from "bun:test";
import {
	NewsFailure,
	buildHnSearchUrl,
	buildSearchUrl,
	clampLimit,
	extractGuardianError,
	fetchLatestNews,
	normalizeFromDate,
	normalizeHnFeed,
	normalizeSection,
	normalizeSource,
	parseGuardianArticles,
	parseHnArticles,
	searchNews,
	sectionQueryValue,
	stripHtml,
	testNewsConnection,
} from "../src/client";

const guardianFixture = {
	response: {
		status: "ok",
		total: 2,
		results: [
			{
				id: "world/2026/aug/15/example",
				sectionId: "world",
				sectionName: "World news",
				webPublicationDate: "2026-08-15T12:00:00Z",
				webTitle: "Example headline",
				webUrl: "https://www.theguardian.com/world/2026/aug/15/example",
				fields: {
					trailText: "A <strong>short</strong> &amp; useful summary.",
					byline: "Ada Lovelace",
					thumbnail: "https://media.guim.co.uk/example.jpg",
				},
			},
			{
				id: "technology/2026/aug/15/other",
				webTitle: "Missing url is skipped",
			},
		],
	},
};

const hnFixture = {
	nbHits: 1,
	hits: [
		{
			objectID: "12345",
			title: "Show HN: Example",
			url: "https://example.com/hn",
			author: "pg",
			created_at: "2026-08-15T12:00:00.000Z",
			points: 42,
			num_comments: 7,
			_tags: ["story", "show_hn", "author_pg"],
		},
	],
};

describe("news client helpers", () => {
	it("clamps article limits", () => {
		expect(clampLimit(undefined)).toBe(8);
		expect(clampLimit(0)).toBe(1);
		expect(clampLimit(99)).toBe(20);
		expect(clampLimit("4")).toBe(4);
	});

	it("normalizes sections, sources, and dates", () => {
		expect(normalizeSection("")).toBe("all");
		expect(normalizeSection("ALL")).toBe("all");
		expect(normalizeSection("US-News")).toBe("us-news");
		expect(normalizeSection("not valid!")).toBe("all");
		expect(sectionQueryValue("all")).toBeUndefined();
		expect(sectionQueryValue("technology")).toBe("technology");
		expect(normalizeSource("HN")).toBe("hacker-news");
		expect(normalizeSource("the guardian")).toBe("guardian");
		expect(normalizeSource(undefined)).toBe("all");
		expect(normalizeHnFeed("ask_hn", "latest")).toBe("ask_hn");
		expect(normalizeHnFeed("world", "latest")).toBe("front_page");
		expect(normalizeFromDate("2026-08-01")).toBe("2026-08-01");
		expect(() => normalizeFromDate("08/01/2026")).toThrow(NewsFailure);
		expect(() => normalizeSource("reddit")).toThrow(/Unknown news source/);
	});

	it("strips Guardian trail HTML", () => {
		expect(stripHtml("A <strong>short</strong> &amp; useful summary.")).toBe(
			"A short & useful summary.",
		);
	});

	it("parses Guardian search results and skips incomplete rows", () => {
		const parsed = parseGuardianArticles(guardianFixture);
		expect(parsed.total).toBe(2);
		expect(parsed.articles).toHaveLength(1);
		expect(parsed.articles[0]).toEqual({
			id: "world/2026/aug/15/example",
			source: "The Guardian",
			title: "Example headline",
			section: "World news",
			sectionId: "world",
			publishedAt: "2026-08-15T12:00:00Z",
			url: "https://www.theguardian.com/world/2026/aug/15/example",
			summary: "A short & useful summary.",
			byline: "Ada Lovelace",
			thumbnail: "https://media.guim.co.uk/example.jpg",
		});
	});

	it("parses Hacker News hits and builds a discussion URL", () => {
		const parsed = parseHnArticles(hnFixture);
		expect(parsed.total).toBe(1);
		expect(parsed.articles[0]).toEqual({
			id: "hn:12345",
			source: "Hacker News",
			title: "Show HN: Example",
			section: "Show HN",
			sectionId: "show_hn",
			publishedAt: "2026-08-15T12:00:00.000Z",
			url: "https://example.com/hn",
			summary: "42 points, 7 comments",
			byline: "pg",
			discussionUrl: "https://news.ycombinator.com/item?id=12345",
			score: 42,
			commentCount: 7,
		});
	});

	it("maps Guardian HTTP errors", () => {
		expect(extractGuardianError({}, 401)).toContain("invalid");
		expect(
			extractGuardianError(
				{ response: { message: "Invalid authentication credentials" } },
				403,
			),
		).toBe("Invalid authentication credentials");
	});

	it("builds Guardian and HN search URLs", () => {
		const previousGuardian = process.env.TOBY_NEWS_API_BASE;
		const previousHn = process.env.TOBY_HN_API_BASE;
		process.env.TOBY_NEWS_API_BASE = "https://content.example.test";
		process.env.TOBY_HN_API_BASE = "https://hn.example.test";
		try {
			const guardianUrl = buildSearchUrl({
				query: "climate",
				section: "environment",
				fromDate: "2026-08-01",
				limit: 5,
				orderBy: "newest",
				apiKey: "secret",
			});
			expect(guardianUrl.origin).toBe("https://content.example.test");
			expect(guardianUrl.pathname).toBe("/search");
			expect(guardianUrl.searchParams.get("q")).toBe("climate");

			const hnUrl = buildHnSearchUrl({
				query: "sqlite",
				feed: "story",
				fromDate: "2026-08-01",
				limit: 5,
			});
			expect(hnUrl.origin).toBe("https://hn.example.test");
			expect(hnUrl.pathname).toBe("/search");
			expect(hnUrl.searchParams.get("query")).toBe("sqlite");
			expect(hnUrl.searchParams.get("tags")).toBe("story");
			expect(hnUrl.searchParams.get("numericFilters")).toBe(
				"created_at_i>1785542400",
			);
		} finally {
			if (previousGuardian === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_NEWS_API_BASE");
			} else {
				process.env.TOBY_NEWS_API_BASE = previousGuardian;
			}
			if (previousHn === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_HN_API_BASE");
			} else {
				process.env.TOBY_HN_API_BASE = previousHn;
			}
		}
	});
});

describe("news client fetch", () => {
	it("requires a Guardian API key only for the Guardian source", async () => {
		await expect(fetchLatestNews({}, { source: "guardian" })).rejects.toThrow(
			/API key is required/,
		);
		await expect(searchNews({ apiKey: "k" }, { query: "" })).rejects.toThrow(
			/query is required/,
		);
	});

	it("fetches latest Guardian news through the injected fetch", async () => {
		const fetchImpl = (async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			expect(url.searchParams.get("api-key")).toBe("test-key");
			expect(url.searchParams.has("q")).toBe(false);
			return new Response(JSON.stringify(guardianFixture), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;

		const result = await fetchLatestNews(
			{ apiKey: "test-key", defaultSection: "world" },
			{ source: "guardian", limit: 3 },
			fetchImpl,
		);
		expect(result.source).toBe("The Guardian");
		expect(result.section).toBe("world");
		expect(result.count).toBe(1);
		expect(result.articles[0]?.title).toBe("Example headline");
		expect(result.articles[0]?.source).toBe("The Guardian");
	});

	it("fetches Hacker News without an API key", async () => {
		const fetchImpl = (async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			expect(url.pathname.endsWith("/search")).toBe(true);
			expect(url.searchParams.get("tags")).toBe("front_page");
			return new Response(JSON.stringify(hnFixture), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;

		const result = await fetchLatestNews(
			{},
			{ source: "hacker-news", limit: 5 },
			fetchImpl,
		);
		expect(result.source).toBe("Hacker News");
		expect(result.articles[0]?.id).toBe("hn:12345");
	});

	it("merges sources and skips Guardian when no key is set", async () => {
		const fetchImpl = (async () =>
			new Response(JSON.stringify(hnFixture), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as typeof fetch;
		const result = await fetchLatestNews({}, { source: "all" }, fetchImpl);
		expect(result.source).toBe("Hacker News");
		expect(result.warnings?.[0]).toContain("Guardian skipped");
	});

	it("searches news and surfaces Guardian API errors", async () => {
		const okFetch = (async () =>
			new Response(JSON.stringify(guardianFixture), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as typeof fetch;
		const result = await searchNews(
			{ apiKey: "test-key" },
			{ query: "climate", source: "guardian" },
			okFetch,
		);
		expect(result.query).toBe("climate");
		expect(result.articles).toHaveLength(1);

		const failFetch = (async () =>
			new Response(
				JSON.stringify({
					response: { message: "Invalid authentication credentials" },
				}),
				{ status: 403 },
			)) as typeof fetch;
		await expect(
			testNewsConnection({ apiKey: "bad" }, failFetch),
		).rejects.toThrow("Invalid authentication credentials");
	});
});
