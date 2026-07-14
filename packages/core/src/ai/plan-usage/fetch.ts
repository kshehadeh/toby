import { AI_PROVIDERS, getAIProvider } from "../providers";
import { getPlanUsageAdapter } from "./registry";
import type { AIProviderPlanUsage } from "./types";

const CACHE_TTL_MS = 60_000;

type CacheEntry = {
	readonly usage: AIProviderPlanUsage;
	readonly expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

export function clearPlanUsageCache(providerId?: string): void {
	if (providerId) {
		cache.delete(providerId);
		return;
	}
	cache.clear();
}

/** Build a normalized unsupported response for a known provider. */
function unsupportedResponse(providerId: string): AIProviderPlanUsage {
	const info = getAIProvider(providerId);
	const reason = info
		? `${info.displayName} does not expose plan balance via API. Check usage in the ${info.displayName} dashboard.`
		: `Unknown AI provider: ${providerId}`;
	return {
		providerId,
		supported: false,
		unavailableReason: reason,
		totalSpentLabel: "N/A",
		remainingLabel: "N/A",
		fetchedAt: new Date().toISOString(),
	};
}

export async function fetchAIProviderPlanUsage(
	providerId: string,
): Promise<AIProviderPlanUsage> {
	const now = Date.now();
	const cached = cache.get(providerId);
	if (cached && cached.expiresAt > now) {
		return cached.usage;
	}

	const adapter = getPlanUsageAdapter(providerId);
	if (!adapter) {
		// Known provider without an explicit adapter returns a normalized
		// unsupported response so every provider is represented in the UI.
		if (AI_PROVIDERS.some((p) => p.id === providerId)) {
			return unsupportedResponse(providerId);
		}
		return {
			providerId,
			supported: false,
			unavailableReason: `Unknown AI provider: ${providerId}`,
			totalSpentLabel: "N/A",
			remainingLabel: "N/A",
			fetchedAt: new Date().toISOString(),
		};
	}

	const usage = await adapter.fetchPlanUsage();
	cache.set(providerId, { usage, expiresAt: now + CACHE_TTL_MS });
	return usage;
}

/** Fetch usage for all registered AI providers in parallel. */
export async function fetchAllAIProviderPlanUsage(): Promise<
	AIProviderPlanUsage[]
> {
	return Promise.all(AI_PROVIDERS.map((p) => fetchAIProviderPlanUsage(p.id)));
}

export function providerSupportsPlanUsage(providerId: string): boolean {
	return getAIProvider(providerId)?.supportsPlanUsage === true;
}
