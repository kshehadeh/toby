/**
 * Shared Vercel AI Gateway models catalog fetch.
 * Used by the model-list adapter and context-window resolution.
 */

export const VERCEL_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

/** Align with previous context-window TTL (models change slowly). */
export const VERCEL_CATALOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;

export type VercelCatalogModel = {
	readonly id: string;
	readonly name?: string;
	readonly type?: string;
	readonly contextWindowTokens?: number;
	readonly ownedBy?: string;
	readonly tags?: readonly string[];
};

export type VercelGatewayCatalog = {
	readonly models: readonly VercelCatalogModel[];
	readonly contextWindows: ReadonlyMap<string, number>;
	readonly fetchedAt: number;
};

type CacheEntry = {
	readonly expiresAt: number;
	readonly catalog: VercelGatewayCatalog;
};

let cache: CacheEntry | undefined;
let inFlight: Promise<VercelGatewayCatalog> | undefined;

function positiveFiniteNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function parseCatalog(body: unknown): VercelGatewayCatalog {
	const root = asRecord(body);
	const data = Array.isArray(root?.data) ? root.data : [];
	const models: VercelCatalogModel[] = [];
	const contextWindows = new Map<string, number>();

	for (const item of data) {
		const rec = asRecord(item);
		if (!rec || typeof rec.id !== "string" || !rec.id.trim()) {
			continue;
		}
		const id = rec.id.trim();
		const contextWindowTokens = positiveFiniteNumber(rec.context_window);
		const name = typeof rec.name === "string" ? rec.name : undefined;
		const type = typeof rec.type === "string" ? rec.type : undefined;
		const ownedBy = typeof rec.owned_by === "string" ? rec.owned_by : undefined;
		const tags = Array.isArray(rec.tags)
			? rec.tags.filter((t): t is string => typeof t === "string")
			: undefined;

		models.push({
			id,
			...(name ? { name } : {}),
			...(type ? { type } : {}),
			...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
			...(ownedBy ? { ownedBy } : {}),
			...(tags && tags.length > 0 ? { tags } : {}),
		});

		if (contextWindowTokens !== undefined) {
			contextWindows.set(id.toLowerCase(), contextWindowTokens);
		}
	}

	return {
		models,
		contextWindows,
		fetchedAt: Date.now(),
	};
}

/**
 * Fetch (or return cached) full Vercel AI Gateway model catalog.
 * Public endpoint — no auth required by Vercel; callers gate on configuration.
 */
export async function fetchVercelGatewayCatalog(): Promise<VercelGatewayCatalog> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) {
		return cache.catalog;
	}
	if (inFlight) {
		return inFlight;
	}

	inFlight = (async () => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		try {
			const response = await fetch(VERCEL_MODELS_URL, {
				signal: controller.signal,
			});
			if (!response.ok) {
				throw new Error(
					`AI Gateway models API returned HTTP ${response.status}`,
				);
			}
			const body: unknown = await response.json();
			const catalog = parseCatalog(body);
			cache = {
				expiresAt: Date.now() + VERCEL_CATALOG_CACHE_TTL_MS,
				catalog,
			};
			return catalog;
		} finally {
			clearTimeout(timeout);
			inFlight = undefined;
		}
	})();

	return inFlight;
}

/** Context window map from the shared catalog (throws if fetch fails). */
export async function fetchVercelContextWindows(): Promise<
	ReadonlyMap<string, number>
> {
	const catalog = await fetchVercelGatewayCatalog();
	return catalog.contextWindows;
}

export function clearVercelCatalogCache(): void {
	cache = undefined;
	inFlight = undefined;
}

/**
 * List transcription model IDs from the Vercel AI Gateway catalog.
 * Filters for `type === "transcription"` and falls back to a curated static
 * list when the catalog is unavailable.
 */
export async function listVercelTranscriptionModels(): Promise<string[]> {
	const FALLBACK = [
		"openai/whisper-1",
		"openai/gpt-4o-mini-transcribe",
		"openai/gpt-4o-transcribe",
		"xai/grok-stt",
	];
	try {
		const catalog = await fetchVercelGatewayCatalog();
		const stt = catalog.models
			.filter((m) => m.type === "transcription")
			.map((m) => m.id);
		return stt.length > 0 ? stt : FALLBACK;
	} catch {
		return FALLBACK;
	}
}
