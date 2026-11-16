import type { AIModelListItem, ModelListAdapter } from "../types";
import { fetchVercelGatewayCatalog } from "../vercel-catalog";

/** Vercel AI Gateway catalog tag for schema-constrained output support. */
export const VERCEL_STRUCTURED_OUTPUT_TAG = "structured-output";

export function vercelCatalogToListItems(
	catalog: Awaited<ReturnType<typeof fetchVercelGatewayCatalog>>,
): AIModelListItem[] {
	const items: AIModelListItem[] = [];
	const seen = new Set<string>();

	for (const model of catalog.models) {
		// Prefer language models for chat; if type is missing, keep the model.
		if (model.type && model.type !== "language") {
			continue;
		}
		if (seen.has(model.id)) {
			continue;
		}
		seen.add(model.id);
		const reasoning = model.tags?.includes("reasoning") === true;
		const structuredOutput =
			model.tags?.includes(VERCEL_STRUCTURED_OUTPUT_TAG) === true;
		items.push({
			id: model.id,
			...(model.name ? { displayName: model.name } : {}),
			...(model.contextWindowTokens !== undefined
				? { contextWindowTokens: model.contextWindowTokens }
				: {}),
			...(model.ownedBy ? { ownedBy: model.ownedBy } : {}),
			...(reasoning ? { reasoning: true } : {}),
			...(structuredOutput ? { structuredOutput: true } : {}),
		});
	}

	return items;
}

export const vercelGatewayModelListAdapter: ModelListAdapter = {
	providerId: "vercel",

	async fetchModels() {
		const fetchedAt = new Date().toISOString();
		try {
			const catalog = await fetchVercelGatewayCatalog();
			return {
				providerId: "vercel",
				remote: true,
				models: vercelCatalogToListItems(catalog),
				fetchedAt,
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return {
				providerId: "vercel",
				remote: true,
				models: [],
				unavailableReason: `Failed to reach Vercel AI Gateway models API: ${msg}`,
				fetchedAt,
			};
		}
	},
};
