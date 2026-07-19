import { getDefaultProvider } from "../config/index";
import { getIntegrationModules } from "../integrations/index";
import type {
	IntegrationModule,
	ProviderCategory,
} from "../integrations/types";
import { daemonLog } from "../logging/daemon-log";
import type {
	DashboardCategorySummary,
	DashboardData,
	DashboardGroup,
	DashboardItem,
	DashboardProviderSummary,
	DashboardSummaryResult,
} from "./types";

const CACHE_TTL_MS = 60_000;
const PER_PROVIDER_TIMEOUT_MS = 25_000;
const DEFAULT_LIMIT = 20;
const MAX_ITEMS_PER_CATEGORY = 100;

/** Categories that should prefer the configured default provider when set. */
const DEFAULT_PROVIDER_ONLY_CATEGORIES = new Set<string>(["calendar"]);

interface CategoryCacheEntry {
	readonly data: DashboardCategorySummary | null;
	readonly expiresAt: number;
}

const categoryCache = new Map<string, CategoryCacheEntry>();

/**
 * Get an aggregated dashboard summary for a single category, cached for the
 * TTL window. Returns `null` if no connected providers contributed data.
 *
 * Pass `force: true` to bypass the in-memory cache (manual UI refresh).
 */
export async function getDashboardCategory(
	category: string,
	params?: { readonly limit?: number; readonly force?: boolean },
): Promise<DashboardCategorySummary | null> {
	const limit = params?.limit ?? DEFAULT_LIMIT;
	const force = params?.force === true;

	if (!force) {
		const cached = categoryCache.get(category);
		if (cached && Date.now() < cached.expiresAt) {
			return cached.data;
		}
	}

	const data = await aggregateCategory(category, limit);
	categoryCache.set(category, {
		data,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});
	return data;
}

/**
 * Get aggregated dashboard data from all connected providers.
 * Each category is cached independently so a slow provider in one category
 * never blocks another.
 */
export async function getDashboardData(params?: {
	readonly limit?: number;
}): Promise<DashboardData> {
	const limit = params?.limit ?? DEFAULT_LIMIT;

	const [email, tasks, calendar] = await Promise.all([
		getDashboardCategory("email", { limit }),
		getDashboardCategory("tasks", { limit }),
		getDashboardCategory("calendar", { limit }),
	]);

	return { email, tasks, calendar };
}

/**
 * Clear the in-memory dashboard cache. Useful for testing or when a
 * provider's connection state changes.
 */
export function clearDashboardCache(): void {
	categoryCache.clear();
}

/**
 * Call a provider's `dashboard.getSummary` with a timeout. Returns `null` on
 * timeout, failure, or missing hook — one broken provider should never blank
 * the whole card.
 */
async function callProviderWithTimeout(
	module: IntegrationModule,
	limit: number,
): Promise<DashboardSummaryResult | null> {
	if (!module.dashboard) return null;
	try {
		const result = await Promise.race([
			module.dashboard.getSummary({ limit }),
			new Promise<null>((resolve) =>
				setTimeout(() => resolve(null), PER_PROVIDER_TIMEOUT_MS),
			),
		]);
		return result;
	} catch (error) {
		daemonLog("warn", "plugin", "dashboard_provider_error", {
			plugin: module.name,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * Aggregate summaries from all connected providers in a category into a single
 * `DashboardCategorySummary`. Returns `null` if no providers contributed data.
 */
async function aggregateCategory(
	category: string,
	limit: number,
): Promise<DashboardCategorySummary | null> {
	let modules = getIntegrationModules().filter(
		(m) =>
			m.providerCategories?.includes(category as never) &&
			m.dashboard !== undefined,
	);

	// Calendar (and similar) cards should follow Settings → Defaults when set.
	if (DEFAULT_PROVIDER_ONLY_CATEGORIES.has(category)) {
		const defaultName = getDefaultProvider(category as ProviderCategory);
		if (defaultName) {
			const preferred = modules.filter((m) => m.name === defaultName);
			if (preferred.length > 0) {
				modules = preferred;
			}
		}
	}

	if (modules.length === 0) return null;

	const results = await Promise.all(
		modules.map(async (m) => {
			const connected = await m.isConnected().catch(() => false);
			if (!connected) return null;
			const summary = await callProviderWithTimeout(m, limit);
			if (!summary) return null;
			const launchUrl = summary.launchUrl ?? m.launchUrl;
			const providerSummary: DashboardProviderSummary = {
				providerName: m.name,
				providerDisplayName: m.displayName,
				...(m.iconUrl ? { iconUrl: m.iconUrl } : {}),
				...(launchUrl ? { launchUrl } : {}),
				summary,
			};
			return providerSummary;
		}),
	);

	const sources = results.filter(
		(r): r is DashboardProviderSummary => r !== null,
	);

	if (sources.length === 0) return null;

	const totalCount = sources.reduce((sum, s) => sum + s.summary.count, 0);

	// Concatenate items from all sources. Calendar is soonest-first (ascending);
	// email/tasks stay most-recent-first (descending).
	const allItems: DashboardItem[] = [];
	for (const source of sources) {
		for (const item of source.summary.items) {
			allItems.push({ ...item, providerName: source.providerName });
		}
	}
	const ascending = category === "calendar";
	allItems.sort((a, b) => {
		const aTime = a.timestamp ?? "";
		const bTime = b.timestamp ?? "";
		return ascending ? aTime.localeCompare(bTime) : bTime.localeCompare(aTime);
	});
	const cappedItems = allItems.slice(0, MAX_ITEMS_PER_CATEGORY);

	// Union groups from all sources, namespaced by provider to avoid collisions
	const groupMap = new Map<string, DashboardGroup>();
	for (const source of sources) {
		if (!source.summary.groups) continue;
		for (const group of source.summary.groups) {
			const namespacedId = `${source.providerName}:${group.id}`;
			groupMap.set(namespacedId, {
				id: namespacedId,
				label: group.label,
				count: group.count,
			});
		}
	}

	// Most recent generatedAt
	const latestGeneratedAt =
		sources
			.map((s) => s.summary.generatedAt)
			.sort()
			.pop() ?? new Date().toISOString();

	return {
		count: totalCount,
		sources,
		items: cappedItems,
		groups: [...groupMap.values()],
		generatedAt: latestGeneratedAt,
	};
}
