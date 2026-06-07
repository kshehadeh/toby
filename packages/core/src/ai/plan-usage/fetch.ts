import { getAIProvider } from "../providers";
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
		return {
			providerId,
			supported: false,
			unavailableReason: `Unknown AI provider: ${providerId}`,
			fetchedAt: new Date().toISOString(),
		};
	}

	const usage = await adapter.fetchPlanUsage();
	cache.set(providerId, { usage, expiresAt: now + CACHE_TTL_MS });
	return usage;
}

export function providerSupportsPlanUsage(providerId: string): boolean {
	return getAIProvider(providerId)?.supportsPlanUsage === true;
}
