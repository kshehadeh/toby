import { getIntegrationModules } from "../integrations/index";
import type { IntegrationModule } from "../integrations/types";
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

interface CategoryCacheEntry {
	readonly data: DashboardCategorySummary | null;
	readonly expiresAt: number;
}

const categoryCache = new Map<string, CategoryCacheEntry>();

/**
 * Get an aggregated dashboard summary for a single category, cached for the
 * TTL window. Returns `null` if no connected providers contributed data.
 */
export async function getDashboardCategory(
	category: string,
	params?: { readonly limit?: number },
): Promise<DashboardCategorySummary | null> {
	const limit = params?.limit ?? DEFAULT_LIMIT;

	const cached = categoryCache.get(category);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.data;
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

	const [email, tasks] = await Promise.all([
		getDashboardCategory("email", { limit }),
		getDashboardCategory("tasks", { limit }),
	]);

	return { email, tasks };
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
	const modules = getIntegrationModules().filter(
		(m) =>
			m.providerCategories?.includes(category as never) &&
			m.dashboard !== undefined,
	);

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

	// Concatenate items from all sources, sort by timestamp descending
	const allItems: DashboardItem[] = [];
	for (const source of sources) {
		for (const item of source.summary.items) {
			allItems.push({ ...item, providerName: source.providerName });
		}
	}
	allItems.sort((a, b) => {
		const aTime = a.timestamp ?? "";
		const bTime = b.timestamp ?? "";
		return bTime.localeCompare(aTime);
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
