import {
	ALL_SECTIONS,
	DEFAULT_ARTICLE_LIMIT,
	MAX_ARTICLE_LIMIT,
	NEWS_SOURCE_IDS,
	NEWS_USER_AGENT,
	NewsFailure,
	type NewsSourceId,
} from "./types";

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

export function fromDateToUnixSeconds(fromDate: string): number {
	const millis = Date.parse(`${fromDate}T00:00:00.000Z`);
	if (Number.isNaN(millis)) {
		throw new NewsFailure("fromDate must be YYYY-MM-DD.");
	}
	return Math.floor(millis / 1000);
}

export function normalizeSource(value: unknown): NewsSourceId {
	const raw = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/[_\s]+/g, "-");
	if (!raw || raw === "all") {
		return "all";
	}
	if (raw === "guardian" || raw === "the-guardian" || raw === "theguardian") {
		return "guardian";
	}
	if (
		raw === "hacker-news" ||
		raw === "hackernews" ||
		raw === "hn" ||
		raw === "ycombinator"
	) {
		return "hacker-news";
	}
	if ((NEWS_SOURCE_IDS as readonly string[]).includes(raw)) {
		return raw as NewsSourceId;
	}
	throw new NewsFailure(
		`Unknown news source ${JSON.stringify(String(value))}. Use all, guardian, or hacker-news.`,
	);
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

export function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function numberField(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	return undefined;
}

export async function fetchJson(
	url: URL | string,
	fetchImpl: typeof fetch,
	label: string,
): Promise<{ status: number; body: unknown }> {
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
			`Could not reach ${label}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	try {
		return { status: response.status, body: await response.json() };
	} catch {
		throw new NewsFailure(
			`${label} returned a non-JSON response (HTTP ${response.status}).`,
		);
	}
}
