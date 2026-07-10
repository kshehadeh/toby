import {
	OPENROUTER_DEFAULT_BASE_URL,
	resolveOpenRouterApiKey,
} from "../../model-factory";
import type { AIModelListItem, ModelListAdapter } from "../types";

const FETCH_TIMEOUT_MS = 8000;

function modelsUrl(baseUrl: string): string {
	const trimmed = baseUrl.replace(/\/+$/, "");
	return `${trimmed}/models`;
}

function parseOpenRouterModels(body: unknown): AIModelListItem[] {
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
		const rec = entry as {
			id?: unknown;
			name?: unknown;
			context_length?: unknown;
		};
		if (typeof rec.id !== "string" || !rec.id.trim()) {
			continue;
		}
		const id = rec.id.trim();
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		items.push({
			id,
			...(typeof rec.name === "string" ? { displayName: rec.name } : {}),
			...(typeof rec.context_length === "number"
				? { contextWindowTokens: rec.context_length }
				: {}),
		});
	}

	return items;
}

export const openRouterModelListAdapter: ModelListAdapter = {
	providerId: "openrouter",

	async fetchModels() {
		const fetchedAt = new Date().toISOString();
		const apiKey = resolveOpenRouterApiKey();
		const url = modelsUrl(OPENROUTER_DEFAULT_BASE_URL);

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (apiKey) {
				headers.Authorization = `Bearer ${apiKey}`;
			}
			const response = await fetch(url, {
				method: "GET",
				headers,
				signal: controller.signal,
			});
			if (!response.ok) {
				return {
					providerId: "openrouter",
					remote: true,
					models: [],
					unavailableReason: `OpenRouter models API returned ${response.status}: ${response.statusText}`,
					fetchedAt,
				};
			}
			const body: unknown = await response.json();
			return {
				providerId: "openrouter",
				remote: true,
				models: parseOpenRouterModels(body),
				fetchedAt,
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return {
				providerId: "openrouter",
				remote: true,
				models: [],
				unavailableReason: `Failed to reach OpenRouter at ${OPENROUTER_DEFAULT_BASE_URL}: ${msg}`,
				fetchedAt,
			};
		} finally {
			clearTimeout(timeout);
		}
	},
};
