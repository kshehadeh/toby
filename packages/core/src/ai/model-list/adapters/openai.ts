import { resolveOpenAiApiToken } from "../credentials";
import type { AIModelListItem, ModelListAdapter } from "../types";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const FETCH_TIMEOUT_MS = 3000;

/** Non-chat / non-completion model id fragments to exclude from pickers. */
const EXCLUDE_FRAGMENTS = [
	"embedding",
	"embed-",
	"whisper",
	"tts",
	"dall-e",
	"davinci",
	"babbage",
	"moderation",
	"realtime",
	"audio",
	"transcribe",
	"image",
	"sora",
	"text-similarity",
	"text-search",
	"code-search",
	"codex-mini",
] as const;

/**
 * Keep models that look usable for chat/completions in Toby personas.
 */
export function isOpenAiChatModelId(id: string): boolean {
	const lower = id.trim().toLowerCase();
	if (!lower) {
		return false;
	}
	if (EXCLUDE_FRAGMENTS.some((frag) => lower.includes(frag))) {
		return false;
	}
	if (lower.startsWith("gpt-") || lower.startsWith("chatgpt-")) {
		return true;
	}
	// o1, o3, o4-mini, etc.
	if (/^o[0-9]/.test(lower)) {
		return true;
	}
	return false;
}

function parseOpenAiModels(body: unknown): AIModelListItem[] {
	const root =
		body && typeof body === "object" && !Array.isArray(body)
			? (body as { data?: unknown })
			: undefined;
	const data = Array.isArray(root?.data) ? root.data : [];
	const items: AIModelListItem[] = [];
	const seen = new Set<string>();

	for (const entry of data) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const rec = entry as { id?: unknown; owned_by?: unknown };
		if (typeof rec.id !== "string" || !rec.id.trim()) {
			continue;
		}
		const id = rec.id.trim();
		if (!isOpenAiChatModelId(id) || seen.has(id)) {
			continue;
		}
		seen.add(id);
		items.push({
			id,
			...(typeof rec.owned_by === "string" ? { ownedBy: rec.owned_by } : {}),
		});
	}

	return items;
}

export const openAiModelListAdapter: ModelListAdapter = {
	providerId: "openai",

	async fetchModels() {
		const fetchedAt = new Date().toISOString();
		const token = resolveOpenAiApiToken();
		if (!token) {
			return {
				providerId: "openai",
				remote: true,
				models: [],
				unavailableReason: "OpenAI API token not configured.",
				fetchedAt,
			};
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		try {
			const response = await fetch(OPENAI_MODELS_URL, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				signal: controller.signal,
			});
			if (!response.ok) {
				let detail = response.statusText;
				try {
					const errBody = (await response.json()) as {
						error?: { message?: string };
					};
					if (errBody.error?.message) {
						detail = errBody.error.message;
					}
				} catch {
					// ignore parse errors
				}
				return {
					providerId: "openai",
					remote: true,
					models: [],
					unavailableReason: `OpenAI models API returned ${response.status}: ${detail}`,
					fetchedAt,
				};
			}
			const body: unknown = await response.json();
			return {
				providerId: "openai",
				remote: true,
				models: parseOpenAiModels(body),
				fetchedAt,
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return {
				providerId: "openai",
				remote: true,
				models: [],
				unavailableReason: `Failed to reach OpenAI models API: ${msg}`,
				fetchedAt,
			};
		} finally {
			clearTimeout(timeout);
		}
	},
};
