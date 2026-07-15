import { getUnifiedLogPath } from "../config/index";
import {
	type LogLevel,
	type LogSource,
	type UnifiedLogEntry,
	readUnifiedLogEntries,
} from "./logger";

export type LogQueryFilters = {
	readonly source?: string;
	readonly level?: string;
	readonly category?: string;
	readonly type?: string;
	/** Case-insensitive free-text match across level, category, type, sessionId, and data. */
	readonly q?: string;
	/** Max newest entries to return. Default 100. */
	readonly limit?: number;
};

export type LogFacetBucket = {
	readonly name: string;
	readonly count: number;
};

export type LogQueryFacets = {
	readonly sources: readonly LogFacetBucket[];
	readonly levels: readonly LogFacetBucket[];
	readonly categories: readonly LogFacetBucket[];
	readonly types: readonly LogFacetBucket[];
};

export type LogQueryResult = {
	readonly logPath: string;
	readonly entries: readonly UnifiedLogEntry[];
	readonly limit: number;
	/** Total entries matching filters (before limit). */
	readonly matched: number;
	readonly hasMore: boolean;
	readonly facets: LogQueryFacets;
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 2000;

const LEVEL_ORDER: readonly LogLevel[] = ["error", "warn", "info", "debug"];
const SOURCE_ORDER: readonly LogSource[] = [
	"chat",
	"daemon",
	"server",
	"upgrade",
	"native-app",
	"macos-plugin",
];

export function clampLogLimit(raw: number | undefined): number {
	if (raw === undefined || !Number.isFinite(raw) || raw < 1) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(raw), MAX_LIMIT);
}

function normalizeFilter(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function entryMatchesSearch(entry: UnifiedLogEntry, q: string): boolean {
	const needle = q.toLowerCase();
	if (entry.level.toLowerCase().includes(needle)) return true;
	if (entry.category.toLowerCase().includes(needle)) return true;
	if (entry.type.toLowerCase().includes(needle)) return true;
	if (entry.source.toLowerCase().includes(needle)) return true;
	if (entry.sessionId?.toLowerCase().includes(needle)) return true;
	if (entry.ts.toLowerCase().includes(needle)) return true;
	if (entry.data) {
		try {
			const json = JSON.stringify(entry.data).toLowerCase();
			if (json.includes(needle)) return true;
		} catch {
			// ignore non-serializable data
		}
	}
	return false;
}

export function matchesLogFilters(
	entry: UnifiedLogEntry,
	filters: LogQueryFilters,
): boolean {
	const source = normalizeFilter(filters.source);
	const level = normalizeFilter(filters.level)?.toLowerCase();
	const category = normalizeFilter(filters.category);
	const type = normalizeFilter(filters.type);
	const q = normalizeFilter(filters.q);

	if (source && entry.source !== source) return false;
	if (level && entry.level.toLowerCase() !== level) return false;
	if (category && entry.category !== category) return false;
	if (type && entry.type !== type) return false;
	if (q && !entryMatchesSearch(entry, q)) return false;
	return true;
}

function countBy(
	entries: readonly UnifiedLogEntry[],
	key: (e: UnifiedLogEntry) => string,
	preferredOrder?: readonly string[],
): LogFacetBucket[] {
	const counts = new Map<string, number>();
	for (const entry of entries) {
		const name = key(entry);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	const names = [...counts.keys()];
	if (preferredOrder) {
		const preferredSet = new Set(preferredOrder);
		const known = preferredOrder.filter((n) => counts.has(n));
		const unknown = names
			.filter((n) => !preferredSet.has(n))
			.sort((a, b) => a.localeCompare(b));
		return [...known, ...unknown].map((name) => ({
			name,
			count: counts.get(name) ?? 0,
		}));
	}
	return [...names]
		.sort((a, b) => a.localeCompare(b))
		.map((name) => ({ name, count: counts.get(name) ?? 0 }));
}

/**
 * Facets use dimension-relaxed matching: each facet is counted with that
 * dimension's filter removed so pickers stay populated under partial filters.
 */
function buildFacets(
	all: readonly UnifiedLogEntry[],
	filters: LogQueryFilters,
): LogQueryFacets {
	const base = {
		q: filters.q,
	};
	const forSources = all.filter((e) =>
		matchesLogFilters(e, {
			...base,
			level: filters.level,
			category: filters.category,
			type: filters.type,
		}),
	);
	const forLevels = all.filter((e) =>
		matchesLogFilters(e, {
			...base,
			source: filters.source,
			category: filters.category,
			type: filters.type,
		}),
	);
	const forCategories = all.filter((e) =>
		matchesLogFilters(e, {
			...base,
			source: filters.source,
			level: filters.level,
			type: filters.type,
		}),
	);
	const forTypes = all.filter((e) =>
		matchesLogFilters(e, {
			...base,
			source: filters.source,
			level: filters.level,
			category: filters.category,
		}),
	);

	return {
		sources: countBy(forSources, (e) => e.source, SOURCE_ORDER),
		levels: countBy(forLevels, (e) => e.level, LEVEL_ORDER),
		categories: countBy(forCategories, (e) => e.category),
		types: countBy(forTypes, (e) => e.type),
	};
}

/**
 * Query the unified log with optional filters. Returns newest-first entries
 * capped by `limit`, plus facet buckets for UI population.
 */
export function queryUnifiedLog(filters: LogQueryFilters = {}): LogQueryResult {
	const limit = clampLogLimit(filters.limit);
	const logPath = getUnifiedLogPath();
	const all = readUnifiedLogEntries();
	const filtered = all.filter((e) => matchesLogFilters(e, filters));
	const matched = filtered.length;
	const hasMore = matched > limit;
	// Newest last in file → take suffix then reverse for newest-first UI.
	const window = filtered.slice(-limit);
	const entries = [...window].reverse();

	return {
		logPath,
		entries,
		limit,
		matched,
		hasMore,
		facets: buildFacets(all, filters),
	};
}
