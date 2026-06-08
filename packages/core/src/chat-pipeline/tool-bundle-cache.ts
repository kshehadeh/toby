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

let cached: {
	readonly key: string;
	readonly bundle: IntegrationToolBundle;
} | null = null;

export function getCachedIntegrationToolBundle(
	key: string,
): IntegrationToolBundle | null {
	if (cached?.key === key) {
		return cached.bundle;
	}
	return null;
}

export function setCachedIntegrationToolBundle(
	key: string,
	bundle: IntegrationToolBundle,
): void {
	cached = { key, bundle };
}

/** Drop cached integration tools (scope change, connect/disconnect, tests). */
export function clearSessionToolBundleCache(): void {
	cached = null;
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
