import { getIntegrationCredential } from "../../config/index";
import { readCredentials } from "../../config/index";

const BRAVE_SEARCH_API = "https://api.search.brave.com/res/v1/web/search";

export interface BraveSearchResult {
	readonly title: string;
	readonly url: string;
	readonly description: string;
	readonly pageAge?: string;
}

export interface BraveSearchResponse {
	readonly results: BraveSearchResult[];
	readonly query: string;
}

export interface BraveSearchOptions {
	readonly count?: number;
	readonly freshness?: "pd" | "pw" | "pm" | "py";
	readonly offset?: number;
}

function getBraveSearchApiKey(): string {
	const apiKey = getBraveSearchApiKeyRaw();
	if (!apiKey) {
		throw new Error(
			"Brave Search API key not found. Add it to ~/.toby/credentials.json or run `toby configure`.",
		);
	}
	return apiKey;
}

export function getBraveSearchApiKeyRaw(): string | undefined {
	const creds = readCredentials();
	const apiKey =
		getIntegrationCredential(creds, "bravesearch", "apiKey") ??
		creds.integrations?.bravesearch?.apiKey;
	return apiKey?.trim() || undefined;
}

export async function testBraveSearchConnection(): Promise<void> {
	const apiKey = getBraveSearchApiKey();
	const url = new URL(BRAVE_SEARCH_API);
	url.searchParams.set("q", "test");
	url.searchParams.set("count", "1");

	const response = await fetch(url.toString(), {
		headers: {
			"X-Subscription-Token": apiKey,
			Accept: "application/json",
		},
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(
			`Brave Search API returned HTTP ${response.status}: ${body.slice(0, 200)}`,
		);
	}
}

export async function webSearch(
	query: string,
	options?: BraveSearchOptions,
): Promise<BraveSearchResponse> {
	const apiKey = getBraveSearchApiKey();
	const url = new URL(BRAVE_SEARCH_API);
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(options?.count ?? 10));
	if (options?.freshness) {
		url.searchParams.set("freshness", options.freshness);
	}
	if (options?.offset) {
		url.searchParams.set("offset", String(options.offset));
	}

	const response = await fetch(url.toString(), {
		headers: {
			"X-Subscription-Token": apiKey,
			Accept: "application/json",
		},
		signal: AbortSignal.timeout(15_000),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(
			`Brave Search API returned HTTP ${response.status}: ${body.slice(0, 200)}`,
		);
	}

	const data = (await response.json()) as {
		web?: {
			results?: Array<{
				title?: string;
				url?: string;
				description?: string;
				page_age?: string;
			}>;
		};
	};

	const results: BraveSearchResult[] =
		data.web?.results?.map((r) => ({
			title: r.title ?? "",
			url: r.url ?? "",
			description: r.description ?? "",
			pageAge: r.page_age,
		})) ?? [];

	return { results, query };
}
