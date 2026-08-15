import {
	clampLimit,
	fetchJson,
	normalizeFromDate,
	sectionQueryValue,
	stringField,
	stripHtml,
} from "./helpers";
import {
	type JsonRecord,
	type NewsArticle,
	NewsFailure,
	type NewsSearchParams,
	type NewsSearchResult,
} from "./types";

export const DEFAULT_NEWS_API_BASE = "https://content.guardianapis.com";

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
			source: "The Guardian",
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

export async function guardianSearch(
	config: JsonRecord,
	params: NewsSearchParams,
	fetchImpl: typeof fetch = fetch,
): Promise<NewsSearchResult> {
	const apiKey = getNewsApiKey(config);
	if (!apiKey) {
		throw new NewsFailure(
			"A Guardian Open Platform API key is required for The Guardian. Get a free key at https://open-platform.theguardian.com/access/",
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

	const { status, body } = await fetchJson(url, fetchImpl, "The Guardian API");
	const error = extractGuardianError(body, status);
	if (error) {
		throw new NewsFailure(error);
	}

	const parsed = parseGuardianArticles(body);
	return {
		source: "The Guardian",
		sources: ["The Guardian"],
		...(query ? { query } : {}),
		...(section ? { section } : {}),
		...(fromDate ? { fromDate } : {}),
		count: parsed.articles.length,
		...(parsed.total !== undefined ? { total: parsed.total } : {}),
		articles: parsed.articles,
	};
}
