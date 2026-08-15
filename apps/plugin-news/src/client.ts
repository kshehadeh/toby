import { getNewsApiKey, guardianSearch, hasNewsApiKey } from "./guardian";
import { hnSearch } from "./hacker-news";
import { normalizeSection, normalizeSource } from "./helpers";
import {
	type JsonRecord,
	NewsFailure,
	type NewsSearchParams,
	type NewsSearchResult,
	type NewsSourceId,
	type NewsSourceLabel,
} from "./types";

export {
	ALL_SECTIONS,
	DEFAULT_ARTICLE_LIMIT,
	MAX_ARTICLE_LIMIT,
	NEWS_SECTION_OPTIONS,
	NEWS_SOURCE_IDS,
	NEWS_USER_AGENT,
	NewsFailure,
} from "./types";
export type {
	JsonRecord,
	NewsArticle,
	NewsSearchParams,
	NewsSearchResult,
	NewsSourceId,
	NewsSourceLabel,
} from "./types";
export {
	clampLimit,
	normalizeFromDate,
	normalizeSection,
	normalizeSource,
	sectionQueryValue,
	stripHtml,
} from "./helpers";
export {
	DEFAULT_NEWS_API_BASE,
	buildSearchUrl,
	extractGuardianError,
	getNewsApiKey,
	hasNewsApiKey,
	parseGuardianArticles,
	resolveNewsApiBase,
} from "./guardian";
export {
	DEFAULT_HN_API_BASE,
	buildHnSearchUrl,
	normalizeHnFeed,
	parseHnArticles,
	resolveHnApiBase,
} from "./hacker-news";

export function normalizeConfig(config: JsonRecord): JsonRecord {
	return {
		apiKey: getNewsApiKey(config),
		defaultSection: normalizeSection(config.defaultSection),
		defaultSource: normalizeSource(config.defaultSource ?? "all"),
	};
}

function requestedSources(
	source: NewsSourceId,
): Array<"guardian" | "hacker-news"> {
	if (source === "all") {
		return ["guardian", "hacker-news"];
	}
	return [source];
}

function mergeResults(
	results: NewsSearchResult[],
	params: NewsSearchParams,
	warnings: string[],
): NewsSearchResult {
	const articles = results.flatMap((result) => result.articles);
	const sources = [
		...new Set(results.flatMap((result) => result.sources)),
	] as NewsSourceLabel[];
	const totals = results
		.map((result) => result.total)
		.filter((total): total is number => typeof total === "number");
	const query = String(params.query ?? "").trim();
	const fromDate = String(params.fromDate ?? "").trim();
	const section =
		String(params.section ?? "").trim() ||
		results.find((result) => result.section)?.section;
	return {
		source: sources.length === 1 ? sources[0] : "multiple",
		sources,
		...(query ? { query } : {}),
		...(section ? { section } : {}),
		...(fromDate ? { fromDate } : {}),
		count: articles.length,
		...(totals.length > 0
			? { total: totals.reduce((sum, value) => sum + value, 0) }
			: {}),
		articles,
		...(warnings.length > 0 ? { warnings } : {}),
	};
}

async function collectFromSources(
	config: JsonRecord,
	params: NewsSearchParams,
	mode: "latest" | "search",
	fetchImpl: typeof fetch,
): Promise<NewsSearchResult> {
	const source = normalizeSource(
		params.source ?? config.defaultSource ?? "all",
	);
	const requested = requestedSources(source);
	const results: NewsSearchResult[] = [];
	const warnings: string[] = [];

	for (const id of requested) {
		if (id === "guardian" && !hasNewsApiKey(config)) {
			if (source === "guardian") {
				throw new NewsFailure(
					"A Guardian Open Platform API key is required for The Guardian. Get a free key at https://open-platform.theguardian.com/access/",
				);
			}
			warnings.push(
				"Guardian skipped: add a free API key to include world news.",
			);
			continue;
		}

		try {
			if (id === "guardian") {
				results.push(
					await guardianSearch(
						config,
						{
							...params,
							orderBy:
								mode === "search" ? (params.orderBy ?? "newest") : "newest",
						},
						fetchImpl,
					),
				);
			} else {
				results.push(await hnSearch(params, mode, fetchImpl));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (source !== "all") {
				throw error instanceof NewsFailure ? error : new NewsFailure(message);
			}
			warnings.push(message);
		}
	}

	if (results.length === 0) {
		throw new NewsFailure(
			warnings.join(" ") || "No news sources returned results.",
		);
	}
	return mergeResults(results, params, warnings);
}

export async function fetchLatestNews(
	config: JsonRecord,
	params: Omit<NewsSearchParams, "query" | "orderBy"> = {},
	fetchImpl: typeof fetch = fetch,
): Promise<NewsSearchResult> {
	return collectFromSources(config, params, "latest", fetchImpl);
}

export async function searchNews(
	config: JsonRecord,
	params: NewsSearchParams,
	fetchImpl: typeof fetch = fetch,
): Promise<NewsSearchResult> {
	const query = String(params.query ?? "").trim();
	if (!query) {
		throw new NewsFailure("query is required.");
	}
	return collectFromSources(config, { ...params, query }, "search", fetchImpl);
}

export async function testNewsConnection(
	config: JsonRecord,
	fetchImpl: typeof fetch = fetch,
): Promise<{ sources: NewsSourceLabel[] }> {
	const defaultSource = normalizeSource(config.defaultSource ?? "all");
	const result = await fetchLatestNews(
		config,
		{ source: defaultSource, limit: 1 },
		fetchImpl,
	);
	if (hasNewsApiKey(config) && !result.sources.includes("The Guardian")) {
		const warning = result.warnings?.join(" ") ?? "Guardian check failed.";
		throw new NewsFailure(warning);
	}
	return { sources: result.sources };
}
