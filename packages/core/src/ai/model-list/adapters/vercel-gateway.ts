import type { AIModelListItem, ModelListAdapter } from "../types";
import { fetchVercelGatewayCatalog } from "../vercel-catalog";

function toListItems(
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
		items.push({
			id: model.id,
			...(model.name ? { displayName: model.name } : {}),
			...(model.contextWindowTokens !== undefined
				? { contextWindowTokens: model.contextWindowTokens }
				: {}),
			...(model.ownedBy ? { ownedBy: model.ownedBy } : {}),
			...(reasoning ? { reasoning: true } : {}),
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
				models: toListItems(catalog),
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
