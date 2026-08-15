import type { MemoryItem } from "./types";

const STOP_WORDS = new Set([
	"a",
	"an",
	"the",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"could",
	"should",
	"may",
	"might",
	"can",
	"shall",
	"to",
	"of",
	"in",
	"for",
	"on",
	"with",
	"at",
	"by",
	"from",
	"as",
	"into",
	"through",
	"during",
	"before",
	"after",
	"above",
	"below",
	"between",
	"out",
	"off",
	"over",
	"under",
	"again",
	"further",
	"then",
	"once",
	"and",
	"but",
	"or",
	"nor",
	"not",
	"so",
	"if",
	"this",
	"that",
	"these",
	"those",
	"i",
	"me",
	"my",
	"we",
	"our",
	"you",
	"your",
	"it",
	"its",
	"he",
	"she",
	"they",
	"them",
	"what",
	"which",
	"who",
	"when",
	"where",
	"how",
	"all",
	"each",
	"every",
	"both",
	"few",
	"more",
	"most",
	"other",
	"some",
	"such",
	"no",
	"only",
	"own",
	"same",
	"than",
	"too",
	"very",
	"just",
	"also",
	"about",
	"up",
]);

/** Escape `%`, `_`, and `!` so they are literal in a `LIKE … ESCAPE '!'` pattern. */
export function escapeLikePattern(raw: string): string {
	return raw.replace(/[!%_]/g, (ch) => `!${ch}`);
}

export function extractKeywords(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function haystack(item: MemoryItem): string {
	return `${item.value} ${item.subject ?? ""} ${item.type}`.toLowerCase();
}

export function scoreMemoryMatch(
	item: MemoryItem,
	query: string,
	keywords: readonly string[],
): number {
	const hay = haystack(item);
	const q = query.trim().toLowerCase();
	let score = item.confidence;
	if (q.length > 0 && hay.includes(q)) {
		score += 10;
	}
	for (const kw of keywords) {
		if (hay.includes(kw)) {
			score += 2;
		}
	}
	return score;
}

export function rankMemories(
	items: readonly MemoryItem[],
	query: string,
	keywords: readonly string[],
): MemoryItem[] {
	return [...items].sort((a, b) => {
		const delta =
			scoreMemoryMatch(b, query, keywords) -
			scoreMemoryMatch(a, query, keywords);
		if (delta !== 0) return delta;
		return b.updatedAt.localeCompare(a.updatedAt);
	});
}
