import { chutesModelListAdapter } from "./adapters/chutes";
import { ollamaModelListAdapter } from "./adapters/ollama";
import { openAiModelListAdapter } from "./adapters/openai";
import { openRouterModelListAdapter } from "./adapters/openrouter";
import { vercelGatewayModelListAdapter } from "./adapters/vercel-gateway";
import type { ModelListAdapter } from "./types";

const ADAPTERS: readonly ModelListAdapter[] = [
	openAiModelListAdapter,
	vercelGatewayModelListAdapter,
	ollamaModelListAdapter,
	chutesModelListAdapter,
	openRouterModelListAdapter,
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
