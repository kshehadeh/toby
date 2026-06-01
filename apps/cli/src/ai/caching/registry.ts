import { openAiCacheAdapter } from "./adapters/openai";
import { vercelGatewayCacheAdapter } from "./adapters/vercel-gateway";
import type { CacheAdapter } from "./types";

const ADAPTERS: readonly CacheAdapter[] = [
	openAiCacheAdapter,
	vercelGatewayCacheAdapter,
];

const byId = new Map(ADAPTERS.map((a) => [a.providerId, a]));

export function getCacheAdapter(providerId: string): CacheAdapter | undefined {
	return byId.get(providerId);
}

export function listCacheAdapters(): readonly CacheAdapter[] {
	return ADAPTERS;
}
