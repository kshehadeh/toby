/**
 * OpenRouter speech-to-text model discovery.
 * @see https://openrouter.ai/docs/guides/overview/multimodal/stt
 */

export const OPENROUTER_TRANSCRIPTION_MODELS_URL =
	"https://openrouter.ai/api/v1/models?output_modalities=transcription";

/** Curated fallback when the live catalog is unreachable. */
export const OPENROUTER_TRANSCRIPTION_MODEL_FALLBACK: readonly string[] = [
	"openai/whisper-1",
	"openai/whisper-large-v3",
	"openai/gpt-4o-mini-transcribe",
	"openai/gpt-4o-transcribe",
	"mistralai/voxtral-mini-transcribe",
	"deepgram/nova-3",
];

const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type CacheEntry = {
	readonly expiresAt: number;
	readonly models: readonly string[];
};

let cache: CacheEntry | undefined;
let inFlight: Promise<readonly string[]> | undefined;

function parseTranscriptionModelIds(body: unknown): string[] {
	const root =
		body && typeof body === "object" && !Array.isArray(body)
			? (body as { data?: unknown })
			: undefined;
	const data = Array.isArray(root?.data) ? root.data : [];
	const ids: string[] = [];
	const seen = new Set<string>();

	for (const entry of data) {
		if (!entry || typeof entry !== "object") continue;
		const rec = entry as {
			id?: unknown;
			architecture?: { output_modalities?: unknown };
		};
		if (typeof rec.id !== "string" || !rec.id.trim()) continue;

		// Prefer models the API already filtered; still accept entries that
		// explicitly advertise transcription output when the filter is absent.
		const outputs = rec.architecture?.output_modalities;
		if (Array.isArray(outputs) && outputs.length > 0) {
			const hasTranscription = outputs.some(
				(m) => typeof m === "string" && m.toLowerCase() === "transcription",
			);
			if (!hasTranscription) continue;
		}

		const id = rec.id.trim();
		if (seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}

	return ids;
}

/**
 * List OpenRouter STT model ids from the public Models API filtered by
 * `output_modalities=transcription`. Falls back to a curated list on failure.
 */
export async function listOpenRouterTranscriptionModels(): Promise<string[]> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) {
		return [...cache.models];
	}
	if (inFlight) {
		return [...(await inFlight)];
	}

	inFlight = (async () => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		try {
			const response = await fetch(OPENROUTER_TRANSCRIPTION_MODELS_URL, {
				signal: controller.signal,
				headers: { Accept: "application/json" },
			});
			if (!response.ok) {
				throw new Error(
					`OpenRouter models API returned HTTP ${response.status}`,
				);
			}
			const body: unknown = await response.json();
			const models = parseTranscriptionModelIds(body);
			const resolved =
				models.length > 0
					? models
					: [...OPENROUTER_TRANSCRIPTION_MODEL_FALLBACK];
			cache = {
				expiresAt: Date.now() + CACHE_TTL_MS,
				models: resolved,
			};
			return resolved;
		} catch {
			return [...OPENROUTER_TRANSCRIPTION_MODEL_FALLBACK];
		} finally {
			clearTimeout(timeout);
			inFlight = undefined;
		}
	})();

	return [...(await inFlight)];
}

export function clearOpenRouterTranscriptionCatalogCache(): void {
	cache = undefined;
	inFlight = undefined;
}
