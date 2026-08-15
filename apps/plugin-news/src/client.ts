type JsonRecord = Record<string, unknown>;

export const DEFAULT_NEWS_API_BASE = "https://content.guardianapis.com";
export const NEWS_USER_AGENT = "Toby/news (https://github.com/kshehadeh/toby)";
export const DEFAULT_ARTICLE_LIMIT = 8;
export const MAX_ARTICLE_LIMIT = 20;
export const ALL_SECTIONS = "all";

export const NEWS_SECTION_OPTIONS = [
	ALL_SECTIONS,
	"world",
	"us-news",
	"uk-news",
	"australia-news",
	"technology",
	"business",
	"sport",
	"science",
	"environment",
	"culture",
	"politics",
	"lifeandstyle",
] as const;

export class NewsFailure extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NewsFailure";
	}
}

export type NewsArticle = {
	id: string;
	title: string;
	section: string;
	sectionId: string;
	publishedAt: string;
	url: string;
	summary: string;
	byline?: string;
	thumbnail?: string;
};

export type NewsSearchParams = {
	query?: string;
	section?: string;
	fromDate?: string;
	limit?: number;
	orderBy?: "newest" | "oldest" | "relevance";
};

export type NewsSearchResult = {
	source: "The Guardian";
	query?: string;
	section?: string;
	fromDate?: string;
	count: number;
	total?: number;
	articles: NewsArticle[];
};

type GuardianFields = {
	trailText?: unknown;
	byline?: unknown;
	thumbnail?: unknown;
};

type GuardianResult = {
	id?: unknown;
	sectionId?: unknown;
	sectionName?: unknown;
	webPublicationDate?: unknown;
	webTitle?: unknown;
	webUrl?: unknown;
	fields?: GuardianFields;
};

type GuardianResponse = {
	response?: {
		status?: unknown;
		message?: unknown;
		total?: unknown;
		results?: unknown;
	};
};

export function resolveNewsApiBase(): string {
	const override = process.env.TOBY_NEWS_API_BASE?.trim();
	const raw =
		override && override.length > 0 ? override : DEFAULT_NEWS_API_BASE;
	return raw.replace(/\/+$/, "");
}

export function getNewsApiKey(config: JsonRecord): string {
	return String(config.apiKey ?? "").trim();
}

export function hasNewsApiKey(config: JsonRecord): boolean {
	return getNewsApiKey(config).length > 0;
}

export function clampLimit(
	value: unknown,
	fallback = DEFAULT_ARTICLE_LIMIT,
): number {
	const parsed =
		typeof value === "number"
			? Math.trunc(value)
			: typeof value === "string" && value.trim()
				? Number.parseInt(value, 10)
				: Number.NaN;
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return Math.min(MAX_ARTICLE_LIMIT, Math.max(1, parsed));
}

export function normalizeSection(value: unknown): string {
	const raw = String(value ?? "")
		.trim()
		.toLowerCase();
	if (!raw || raw === ALL_SECTIONS) {
		return ALL_SECTIONS;
	}
	if (!/^[a-z0-9-]+$/.test(raw)) {
		return ALL_SECTIONS;
	}
	return raw;
}

export function sectionQueryValue(value: unknown): string | undefined {
	const section = normalizeSection(value);
	return section === ALL_SECTIONS ? undefined : section;
}

export function normalizeFromDate(value: unknown): string | undefined {
	const raw = String(value ?? "").trim();
	if (!raw) {
		return undefined;
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
		throw new NewsFailure("fromDate must be YYYY-MM-DD.");
	}
	return raw;
}

export function normalizeConfig(config: JsonRecord): JsonRecord {
	return {
		apiKey: getNewsApiKey(config),
		defaultSection: normalizeSection(config.defaultSection),
	};
}

export function stripHtml(value: string): string {
	return value
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function parseGuardianArticles(body: unknown): {
	articles: NewsArticle[];
	total?: number;
} {
	const payload = (body ?? {}) as GuardianResponse;
	const response = payload.response ?? {};
	const rawResults = Array.isArray(response.results) ? response.results : [];
	const articles: NewsArticle[] = [];

	for (const item of rawResults) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			continue;
		}
		const result = item as GuardianResult;
		const title = stringField(result.webTitle);
		const url = stringField(result.webUrl);
		if (!title || !url) {
			continue;
		}
		const fields = result.fields ?? {};
		const summary = stripHtml(stringField(fields.trailText));
		const byline = stripHtml(stringField(fields.byline));
		const thumbnail = stringField(fields.thumbnail);
		articles.push({
			id: stringField(result.id) || url,
			title,
			section: stringField(result.sectionName) || stringField(result.sectionId),
			sectionId: stringField(result.sectionId),
			publishedAt: stringField(result.webPublicationDate),
			url,
			summary,
			...(byline ? { byline } : {}),
			...(thumbnail ? { thumbnail } : {}),
		});
	}

	const total =
		typeof response.total === "number" && Number.isFinite(response.total)
			? response.total
			: undefined;
	return { articles, total };
}

export function extractGuardianError(
	body: unknown,
	statusCode: number,
): string | undefined {
	const payload = (body ?? {}) as GuardianResponse;
	const message = stringField(payload.response?.message);
	if (message) {
		return message;
	}
	if (statusCode === 401 || statusCode === 403) {
		return "Guardian API key is invalid. Check the key in Toby configure.";
	}
	if (statusCode >= 400) {
		return `The Guardian API request failed (HTTP ${statusCode}).`;
	}
	return undefined;
}

export function buildSearchUrl(params: {
	query?: string;
	section?: string;
	fromDate?: string;
	limit: number;
	orderBy: "newest" | "oldest" | "relevance";
	apiKey: string;
}): URL {
	const url = new URL("search", `${resolveNewsApiBase()}/`);
	url.searchParams.set("api-key", params.apiKey);
	url.searchParams.set("order-by", params.orderBy);
	url.searchParams.set("page-size", String(params.limit));
	url.searchParams.set("show-fields", "trailText,byline,thumbnail");
	if (params.query) {
		url.searchParams.set("q", params.query);
	}
	if (params.section) {
		url.searchParams.set("section", params.section);
	}
	if (params.fromDate) {
		url.searchParams.set("from-date", params.fromDate);
	}
	return url;
}

async function guardianSearch(
	config: JsonRecord,
	params: NewsSearchParams,
	fetchImpl: typeof fetch = fetch,
): Promise<NewsSearchResult> {
	const apiKey = getNewsApiKey(config);
	if (!apiKey) {
		throw new NewsFailure(
			"A Guardian Open Platform API key is required. Get a free key at https://open-platform.theguardian.com/access/",
		);
	}

	const query = String(params.query ?? "").trim();
	const section =
		sectionQueryValue(params.section) ??
		sectionQueryValue(config.defaultSection);
	const fromDate = normalizeFromDate(params.fromDate);
	const limit = clampLimit(params.limit);
	const orderBy = params.orderBy ?? "newest";
	const url = buildSearchUrl({
		query: query || undefined,
		section,
		fromDate,
		limit,
		orderBy,
		apiKey,
	});

	let response: Response;
	try {
		response = await fetchImpl(url.toString(), {
			headers: {
				Accept: "application/json",
				"User-Agent": NEWS_USER_AGENT,
			},
			signal: AbortSignal.timeout(15_000),
		});
	} catch (error) {
		throw new NewsFailure(
			`Could not reach The Guardian API: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new NewsFailure(
			`The Guardian API returned a non-JSON response (HTTP ${response.status}).`,
		);
	}

	const error = extractGuardianError(body, response.status);
	if (error) {
		throw new NewsFailure(error);
	}

	const parsed = parseGuardianArticles(body);
	return {
		source: "The Guardian",
		...(query ? { query } : {}),
		...(section ? { section } : {}),
		...(fromDate ? { fromDate } : {}),
		count: parsed.articles.length,
		...(parsed.total !== undefined ? { total: parsed.total } : {}),
		articles: parsed.articles,
	};
}

export async function fetchLatestNews(
	config: JsonRecord,
	params: Omit<NewsSearchParams, "query" | "orderBy"> = {},
	fetchImpl: typeof fetch = fetch,
): Promise<NewsSearchResult> {
	return guardianSearch(config, { ...params, orderBy: "newest" }, fetchImpl);
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
	return guardianSearch(
		config,
		{ ...params, query, orderBy: params.orderBy ?? "newest" },
		fetchImpl,
	);
}

export async function testNewsConnection(
	config: JsonRecord,
	fetchImpl: typeof fetch = fetch,
): Promise<void> {
	await fetchLatestNews(config, { limit: 1 }, fetchImpl);
}
