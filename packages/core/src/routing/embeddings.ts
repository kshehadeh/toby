import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModel } from "ai";
import { embed, embedMany } from "ai";
import {
	buildAiGatewayAttributionHeaders,
	isGatewayModelSlug,
} from "../ai/model-factory";
import type { Persona } from "../config/index";
import { readCredentials } from "../config/index";

const OPENAI_EMBED_DEFAULT = "text-embedding-3-small";
const VERCEL_EMBED_DEFAULT = "openai/text-embedding-3-small";

function resolveOpenAiToken(): string | null {
	const creds = readCredentials();
	const token = creds.ai?.openai?.token?.trim();
	return token && token.length > 0 ? token : null;
}

function resolveVercelGatewayApiKey(): string | undefined {
	const creds = readCredentials();
	const fromCreds = creds.ai?.vercel?.apiKey?.trim();
	if (fromCreds) {
		return fromCreds;
	}
	const fromEnv = process.env.AI_GATEWAY_API_KEY?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

function canUseVercelGateway(): boolean {
	return Boolean(
		resolveVercelGatewayApiKey() || process.env.VERCEL_OIDC_TOKEN?.trim(),
	);
}

export function resolveRoutingEmbedModelId(persona: Persona): string {
	const fromEnv = process.env.TOBY_ROUTING_EMBED_MODEL?.trim();
	if (fromEnv && fromEnv.length > 0) {
		if (persona.ai.provider === "vercel" && !fromEnv.includes("/")) {
			return `openai/${fromEnv}`;
		}
		return fromEnv;
	}
	if (persona.ai.provider === "vercel") {
		return VERCEL_EMBED_DEFAULT;
	}
	return OPENAI_EMBED_DEFAULT;
}

export function createEmbeddingModelForPersona(
	persona: Persona,
): EmbeddingModel | null {
	const modelId = resolveRoutingEmbedModelId(persona);
	try {
		if (persona.ai.provider === "openai") {
			const token = resolveOpenAiToken();
			if (!token) {
				return null;
			}
			const openai = createOpenAI({ apiKey: token });
			return openai.textEmbeddingModel(modelId);
		}
		if (persona.ai.provider === "vercel") {
			if (!canUseVercelGateway()) {
				return null;
			}
			const apiKey = resolveVercelGatewayApiKey();
			const gateway = createGateway({
				...(apiKey ? { apiKey } : {}),
				headers: buildAiGatewayAttributionHeaders(),
			});
			const slug = isGatewayModelSlug(modelId) ? modelId : `openai/${modelId}`;
			return gateway.textEmbeddingModel(slug);
		}
	} catch {
		return null;
	}
	return null;
}

export async function embedTexts(params: {
	readonly model: EmbeddingModel;
	readonly values: readonly string[];
	readonly abortSignal?: AbortSignal;
}): Promise<number[][]> {
	if (params.values.length === 0) {
		return [];
	}
	if (params.values.length === 1) {
		const single = params.values[0];
		if (!single) {
			return [];
		}
		const result = await embed({
			model: params.model,
			value: single,
			abortSignal: params.abortSignal,
		});
		return [[...result.embedding]];
	}
	const result = await embedMany({
		model: params.model,
		values: [...params.values],
		abortSignal: params.abortSignal,
	});
	return result.embeddings.map((e) => [...e]);
}
