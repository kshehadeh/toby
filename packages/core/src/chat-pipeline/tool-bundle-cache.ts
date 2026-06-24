import type { Tool } from "ai";
import type { IntegrationModule } from "../integrations/types";

export type IntegrationToolBundle = {
	readonly tools: Record<string, Tool>;
	readonly toolIntegrationLabels: Record<string, string>;
};

export type ToolBundleCacheKeyParams = {
	readonly moduleNames: readonly string[];
	readonly dryRun: boolean;
};

/** Stable cache key for integration tool definitions within a chat session. */
export function buildToolBundleCacheKey(
	params: ToolBundleCacheKeyParams,
): string {
	const names = [...params.moduleNames].sort().join(",");
	return `${params.dryRun ? "dry" : "live"}:${names}`;
}

const LRU_MAX_ENTRIES = 4;

const lruEntries: Array<{
	readonly key: string;
	readonly bundle: IntegrationToolBundle;
}> = [];

export function getCachedIntegrationToolBundle(
	key: string,
): IntegrationToolBundle | null {
	const idx = lruEntries.findIndex((e) => e.key === key);
	if (idx === -1) return null;
	// Move-to-end for LRU
	if (idx < lruEntries.length - 1) {
		const [entry] = lruEntries.splice(idx, 1);
		if (entry) lruEntries.push(entry);
	}
	const last = lruEntries[lruEntries.length - 1];
	return last ? last.bundle : null;
}

export function setCachedIntegrationToolBundle(
	key: string,
	bundle: IntegrationToolBundle,
): void {
	const idx = lruEntries.findIndex((e) => e.key === key);
	if (idx !== -1) {
		lruEntries.splice(idx, 1);
	}
	lruEntries.push({ key, bundle });
	while (lruEntries.length > LRU_MAX_ENTRIES) {
		lruEntries.shift();
	}
}

/** Drop cached integration tools (scope change, connect/disconnect, tests). */
export function clearSessionToolBundleCache(): void {
	lruEntries.length = 0;
}

export async function loadIntegrationToolBundle(
	modules: readonly IntegrationModule[],
	options: { readonly dryRun: boolean; readonly maxResults?: number },
): Promise<IntegrationToolBundle> {
	const cacheKey = buildToolBundleCacheKey({
		moduleNames: modules.map((m) => m.name),
		dryRun: options.dryRun,
	});
	const hit = getCachedIntegrationToolBundle(cacheKey);
	if (hit) {
		return hit;
	}

	const toolBundles = await Promise.all(
		modules.map(async (m) => {
			if (!m.createChatTools) {
				return null;
			}
			return await m.createChatTools({
				dryRun: options.dryRun,
				maxResults: options.maxResults,
			});
		}),
	);

	const tools: Record<string, Tool> = {};
	const toolIntegrationLabels: Record<string, string> = {};
	for (let i = 0; i < toolBundles.length; i++) {
		const bundle = toolBundles[i];
		const module = modules[i];
		if (!bundle || !module) {
			continue;
		}
		Object.assign(tools, bundle.tools);
		for (const toolName of Object.keys(bundle.tools)) {
			toolIntegrationLabels[toolName] = module.displayName;
		}
	}

	const result: IntegrationToolBundle = { tools, toolIntegrationLabels };
	setCachedIntegrationToolBundle(cacheKey, result);
	return result;
}
