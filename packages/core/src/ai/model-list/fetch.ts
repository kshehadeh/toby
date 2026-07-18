import { readConfig } from "../../config/index";
import { isAIProviderConfigured } from "../model-factory";
import { type AIProviderInfo, AI_PROVIDERS, getAIProvider } from "../providers";
import { getModelListAdapter } from "./registry";
import type { AIModelListItem, AIProviderModelList } from "./types";
import {
	clearVercelCatalogCache,
	fetchVercelGatewayCatalog,
} from "./vercel-catalog";

/** Provider row for settings / persona pickers — models carry catalog metadata. */
export type AIProviderForUI = Omit<AIProviderInfo, "models"> & {
	readonly models: readonly AIModelListItem[];
};

/**
 * When the live model list fell back to curated ids (no tags), re-apply
 * Vercel catalog `reasoning` tags so pickers still show the indicator.
 */
async function enrichVercelReasoningFlags(
	models: readonly AIModelListItem[],
): Promise<AIModelListItem[]> {
	if (models.length === 0) return [...models];
	// Live catalog path already stamped reasoning on tagged models.
	if (models.some((m) => m.reasoning === true)) {
		return [...models];
	}
	try {
		const catalog = await fetchVercelGatewayCatalog();
		const reasoningIds = new Set(
			catalog.models
				.filter((m) => m.tags?.includes("reasoning") === true)
				.map((m) => m.id),
		);
		return models.map((m) =>
			reasoningIds.has(m.id) ? { ...m, reasoning: true } : m,
		);
	} catch {
		return [...models];
	}
}

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
 * Catalog metadata (e.g. `reasoning`) is preserved for picker labels.
 */
export async function resolveAIProvidersForUI(): Promise<AIProviderForUI[]> {
	const customModels = readConfig().ai?.customModels ?? {};

	return Promise.all(
		AI_PROVIDERS.map(async (provider) => {
			const list = await fetchAIProviderModels(provider.id);
			let remoteItems = uniqueModelItems(list.models);
			// Curated Vercel fallbacks omit tags; re-apply reasoning from the
			// public catalog when possible so pickers stay informative.
			if (provider.id === "vercel") {
				remoteItems = await enrichVercelReasoningFlags(remoteItems);
			}
			const remoteSet = new Set(remoteItems.map((m) => m.id));
			// Only append custom entries that are not already in the provider list.
			const extras = (customModels[provider.id] ?? [])
				.map((id) => id.trim())
				.filter((id) => id && !remoteSet.has(id))
				.map((id): AIModelListItem => ({ id }));
			return {
				...provider,
				models: uniqueModelItems([...remoteItems, ...extras]),
			};
		}),
	);
}
