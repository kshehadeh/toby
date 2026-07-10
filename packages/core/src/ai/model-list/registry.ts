import { ollamaModelListAdapter } from "./adapters/ollama";
import { openAiModelListAdapter } from "./adapters/openai";
import { vercelGatewayModelListAdapter } from "./adapters/vercel-gateway";
import type { ModelListAdapter } from "./types";

const ADAPTERS: readonly ModelListAdapter[] = [
	openAiModelListAdapter,
	vercelGatewayModelListAdapter,
	ollamaModelListAdapter,
];

const byId = new Map(ADAPTERS.map((a) => [a.providerId, a]));

export function getModelListAdapter(
	providerId: string,
): ModelListAdapter | undefined {
	return byId.get(providerId);
}

export function listModelListAdapters(): readonly ModelListAdapter[] {
	return ADAPTERS;
}
