import { describe, expect, it } from "bun:test";
import {
	NewsFailure,
	buildSearchUrl,
	clampLimit,
	extractGuardianError,
	fetchLatestNews,
	normalizeFromDate,
	normalizeSection,
	parseGuardianArticles,
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

describe("news client helpers", () => {
	it("clamps article limits", () => {
		expect(clampLimit(undefined)).toBe(8);
		expect(clampLimit(0)).toBe(1);
		expect(clampLimit(99)).toBe(20);
		expect(clampLimit("4")).toBe(4);
	});

	it("normalizes sections and dates", () => {
		expect(normalizeSection("")).toBe("all");
		expect(normalizeSection("ALL")).toBe("all");
		expect(normalizeSection("US-News")).toBe("us-news");
		expect(normalizeSection("not valid!")).toBe("all");
		expect(sectionQueryValue("all")).toBeUndefined();
		expect(sectionQueryValue("technology")).toBe("technology");
		expect(normalizeFromDate("2026-08-01")).toBe("2026-08-01");
		expect(() => normalizeFromDate("08/01/2026")).toThrow(NewsFailure);
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

	it("maps Guardian HTTP errors", () => {
		expect(extractGuardianError({}, 401)).toContain("invalid");
		expect(
			extractGuardianError(
				{ response: { message: "Invalid authentication credentials" } },
				403,
			),
		).toBe("Invalid authentication credentials");
	});

	it("builds a search URL with optional filters", () => {
		const previous = process.env.TOBY_NEWS_API_BASE;
		process.env.TOBY_NEWS_API_BASE = "https://content.example.test";
		try {
			const url = buildSearchUrl({
				query: "climate",
				section: "environment",
				fromDate: "2026-08-01",
				limit: 5,
				orderBy: "newest",
				apiKey: "secret",
			});
			expect(url.origin).toBe("https://content.example.test");
			expect(url.pathname).toBe("/search");
			expect(url.searchParams.get("q")).toBe("climate");
			expect(url.searchParams.get("section")).toBe("environment");
			expect(url.searchParams.get("from-date")).toBe("2026-08-01");
			expect(url.searchParams.get("page-size")).toBe("5");
			expect(url.searchParams.get("api-key")).toBe("secret");
		} finally {
			if (previous === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_NEWS_API_BASE");
			} else {
				process.env.TOBY_NEWS_API_BASE = previous;
			}
		}
	});
});

describe("news client fetch", () => {
	it("requires an API key", async () => {
		await expect(fetchLatestNews({})).rejects.toThrow(/API key is required/);
		await expect(searchNews({ apiKey: "k" }, { query: "" })).rejects.toThrow(
			/query is required/,
		);
	});

	it("fetches latest news through the injected fetch", async () => {
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
			{ limit: 3 },
			fetchImpl,
		);
		expect(result.source).toBe("The Guardian");
		expect(result.section).toBe("world");
		expect(result.count).toBe(1);
		expect(result.articles[0]?.title).toBe("Example headline");
	});

	it("searches news and surfaces API errors", async () => {
		const okFetch = (async () =>
			new Response(JSON.stringify(guardianFixture), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as typeof fetch;
		const result = await searchNews(
			{ apiKey: "test-key" },
			{ query: "climate" },
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
