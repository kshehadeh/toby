import { readConfig } from "../../config/index";
import { isAIProviderConfigured } from "../model-factory";
import { type AIProviderInfo, AI_PROVIDERS, getAIProvider } from "../providers";
import { getModelListAdapter } from "./registry";
import type { AIModelListItem, AIProviderModelList } from "./types";
import { clearVercelCatalogCache } from "./vercel-catalog";

/** OpenAI / Ollama list cache — shorter than Vercel catalog (6h shared cache). */
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = {
	readonly list: AIProviderModelList;
	readonly expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<AIProviderModelList>>();

function curatedItems(providerId: string): AIModelListItem[] {
	const provider = getAIProvider(providerId);
	return (provider?.models ?? []).map((id) => ({ id }));
}

function staticList(
	providerId: string,
	opts: {
		readonly remote: boolean;
		readonly unavailableReason?: string;
	},
): AIProviderModelList {
	return {
		providerId,
		remote: opts.remote,
		models: curatedItems(providerId),
		...(opts.unavailableReason
			? { unavailableReason: opts.unavailableReason }
			: {}),
		fetchedAt: new Date().toISOString(),
	};
}

/** De-dupe model items by id (first occurrence wins; preserves provider order). */
export function uniqueModelItems(
	items: readonly AIModelListItem[],
): AIModelListItem[] {
	const out: AIModelListItem[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		const id = item.id.trim();
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		out.push(item.id === id ? item : { ...item, id });
	}
	return out;
}

function uniqueIds(ids: readonly string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		const trimmed = id.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

/**
 * Prefer the remote catalog as-is when the provider returned models.
 * Curated defaults are only used when remote is empty or failed.
 */
function finalizeRemoteList(
	providerId: string,
	remote: AIProviderModelList,
): AIProviderModelList {
	const models = uniqueModelItems(remote.models);
	if (models.length === 0) {
		return staticList(providerId, {
			remote: true,
			unavailableReason:
				remote.unavailableReason ??
				"Remote model list was empty; showing curated defaults.",
		});
	}
	return {
		...remote,
		models,
	};
}

export function clearModelListCache(providerId?: string): void {
	if (providerId) {
		cache.delete(providerId);
		if (providerId === "vercel") {
			clearVercelCatalogCache();
		}
		return;
	}
	cache.clear();
	clearVercelCatalogCache();
}

/**
 * Fetch available models for a provider.
 * Remote APIs are only called when the provider is configured.
 * On success, returns the provider list only (no curated merge).
 * Failures soft-fall back to curated static models.
 */
export async function fetchAIProviderModels(
	providerId: string,
): Promise<AIProviderModelList> {
	const now = Date.now();
	const cached = cache.get(providerId);
	if (cached && cached.expiresAt > now) {
		return cached.list;
	}

	const existing = inFlight.get(providerId);
	if (existing) {
		return existing;
	}

	const promise = (async (): Promise<AIProviderModelList> => {
		if (!getAIProvider(providerId)) {
			return {
				providerId,
				remote: false,
				models: [],
				unavailableReason: `Unknown AI provider: ${providerId}`,
				fetchedAt: new Date().toISOString(),
			};
		}

		if (!isAIProviderConfigured(providerId)) {
			const provider = getAIProvider(providerId);
			if (!provider?.publicCatalog) {
				return staticList(providerId, {
					remote: false,
					unavailableReason: "Provider not configured.",
				});
			}
		}

		const adapter = getModelListAdapter(providerId);
		if (!adapter) {
			return staticList(providerId, {
				remote: false,
				unavailableReason: `No model list adapter for provider: ${providerId}`,
			});
		}

		const remote = await adapter.fetchModels();
		const finalList = finalizeRemoteList(providerId, remote);

		cache.set(providerId, {
			list: finalList,
			expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
		});
		return finalList;
	})();

	inFlight.set(providerId, promise);
	try {
		return await promise;
	} finally {
		inFlight.delete(providerId);
	}
}

/**
 * Resolve full AI provider catalog for UI (settings, persona editor).
 * Models are live when the provider is configured; otherwise curated defaults.
 * User `customModels` are appended only when not already in the list.
 */
export async function resolveAIProvidersForUI(): Promise<AIProviderInfo[]> {
	const customModels = readConfig().ai?.customModels ?? {};

	return Promise.all(
		AI_PROVIDERS.map(async (provider) => {
			const list = await fetchAIProviderModels(provider.id);
			const remoteIds = list.models.map((m) => m.id);
			const remoteSet = new Set(remoteIds);
			// Only append custom entries that are not already in the provider list.
			const extras = (customModels[provider.id] ?? []).filter(
				(id) => id.trim() && !remoteSet.has(id.trim()),
			);
			const modelIds = uniqueIds([...remoteIds, ...extras]);
			return {
				...provider,
				models: modelIds,
			};
		}),
	);
}
