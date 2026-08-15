export type JsonRecord = Record<string, unknown>;

export const NEWS_USER_AGENT = "Toby/news (https://github.com/kshehadeh/toby)";
export const DEFAULT_ARTICLE_LIMIT = 8;
export const MAX_ARTICLE_LIMIT = 20;
export const ALL_SECTIONS = "all";

export const NEWS_SOURCE_IDS = ["all", "guardian", "hacker-news"] as const;
export type NewsSourceId = (typeof NEWS_SOURCE_IDS)[number];
export type NewsSourceLabel = "The Guardian" | "Hacker News";

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
	source: NewsSourceLabel;
	title: string;
	section: string;
	sectionId: string;
	publishedAt: string;
	url: string;
	summary: string;
	byline?: string;
	thumbnail?: string;
	discussionUrl?: string;
	score?: number;
	commentCount?: number;
};

export type NewsSearchParams = {
	query?: string;
	source?: string;
	section?: string;
	fromDate?: string;
	limit?: number;
	orderBy?: "newest" | "oldest" | "relevance";
};

export type NewsSearchResult = {
	source: NewsSourceLabel | "multiple";
	sources: NewsSourceLabel[];
	query?: string;
	section?: string;
	fromDate?: string;
	count: number;
	total?: number;
	articles: NewsArticle[];
	warnings?: string[];
};
