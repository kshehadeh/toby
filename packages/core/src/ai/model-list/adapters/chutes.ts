import {
	CHUTES_DEFAULT_BASE_URL,
	resolveChutesApiKey,
} from "../../model-factory";
import type { AIModelListItem, ModelListAdapter } from "../types";

const FETCH_TIMEOUT_MS = 5000;

function modelsUrl(baseUrl: string): string {
	const trimmed = baseUrl.replace(/\/+$/, "");
	return `${trimmed}/models`;
}

function parseChutesModels(body: unknown): AIModelListItem[] {
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
			owned_by?: unknown;
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
			...(typeof rec.owned_by === "string" ? { ownedBy: rec.owned_by } : {}),
			...(typeof rec.context_length === "number"
				? { contextWindowTokens: rec.context_length }
				: {}),
		});
	}

	return items;
}

export const chutesModelListAdapter: ModelListAdapter = {
	providerId: "chutes",

	async fetchModels() {
		const fetchedAt = new Date().toISOString();
		const apiKey = resolveChutesApiKey();
		const url = modelsUrl(CHUTES_DEFAULT_BASE_URL);

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
					providerId: "chutes",
					remote: true,
					models: [],
					unavailableReason: `Chutes models API returned ${response.status}: ${response.statusText}`,
					fetchedAt,
				};
			}
			const body: unknown = await response.json();
			return {
				providerId: "chutes",
				remote: true,
				models: parseChutesModels(body),
				fetchedAt,
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return {
				providerId: "chutes",
				remote: true,
				models: [],
				unavailableReason: `Failed to reach Chutes at ${CHUTES_DEFAULT_BASE_URL}: ${msg}`,
				fetchedAt,
			};
		} finally {
			clearTimeout(timeout);
		}
	},
};
