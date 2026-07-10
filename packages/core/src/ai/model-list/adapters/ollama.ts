import { resolveOllamaApiKey, resolveOllamaBaseUrl } from "../../model-factory";
import type { AIModelListItem, ModelListAdapter } from "../types";

const FETCH_TIMEOUT_MS = 3000;

function modelsUrl(baseUrl: string): string {
	const trimmed = baseUrl.replace(/\/+$/, "");
	return `${trimmed}/models`;
}

function parseOllamaModels(body: unknown): AIModelListItem[] {
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
		if (seen.has(id)) {
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

export const ollamaModelListAdapter: ModelListAdapter = {
	providerId: "ollama",

	async fetchModels() {
		const fetchedAt = new Date().toISOString();
		const baseUrl = resolveOllamaBaseUrl();
		const apiKey = resolveOllamaApiKey();
		const url = modelsUrl(baseUrl);

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
					providerId: "ollama",
					remote: true,
					models: [],
					unavailableReason: `Ollama models API returned ${response.status}: ${response.statusText}`,
					fetchedAt,
				};
			}
			const body: unknown = await response.json();
			return {
				providerId: "ollama",
				remote: true,
				models: parseOllamaModels(body),
				fetchedAt,
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return {
				providerId: "ollama",
				remote: true,
				models: [],
				unavailableReason: `Failed to reach Ollama at ${baseUrl}: ${msg}`,
				fetchedAt,
			};
		} finally {
			clearTimeout(timeout);
		}
	},
};
