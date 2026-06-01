import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { type LanguageModel, wrapLanguageModel } from "ai";
import { readCredentials } from "../config/index";
import type { Persona } from "../config/index";
import { resolveDefaultPersona } from "../personas/index";
import { getAIProvider } from "./providers";
import {
	createRecordMiddleware,
	createReplayModel,
	isRecording,
	isReplaying,
} from "./replay";

const GATEWAY_SLUG_RE = /^[a-z0-9-]+\/[a-z0-9][a-z0-9.-]*$/i;

const OPENAI_AUX_DEFAULT = "gpt-4.1-mini";
const VERCEL_AUX_DEFAULT = "openai/gpt-4.1-mini";

/** Default app URL for Vercel AI Gateway attribution (https://vercel.com/docs/ai-gateway/ecosystem/app-attribution). */
const DEFAULT_AI_GATEWAY_HTTP_REFERER = "https://github.com/kshehadeh/toby";
const DEFAULT_AI_GATEWAY_X_TITLE = "Toby";

/** Vercel AI Gateway app attribution headers (optional for gateway; see Vercel docs). */
export function buildAiGatewayAttributionHeaders(): Record<string, string> {
	const referer =
		process.env.TOBY_AI_GATEWAY_REFERER?.trim() ||
		process.env.AI_GATEWAY_HTTP_REFERER?.trim() ||
		DEFAULT_AI_GATEWAY_HTTP_REFERER;
	const title =
		process.env.TOBY_AI_GATEWAY_APP_TITLE?.trim() ||
		process.env.AI_GATEWAY_X_TITLE?.trim() ||
		DEFAULT_AI_GATEWAY_X_TITLE;
	return {
		"http-referer": referer,
		"x-title": title,
	};
}

export function isGatewayModelSlug(model: string): boolean {
	return model.includes("/");
}

export function validatePersonaAi(persona: Persona): void {
	const provider = getAIProvider(persona.ai.provider);
	if (!provider) {
		throw new Error(
			`Unknown AI provider: ${persona.ai.provider}. Run \`toby configure\` to choose a supported provider.`,
		);
	}

	if (provider.modelFormat === "gateway-slug") {
		if (!GATEWAY_SLUG_RE.test(persona.ai.model)) {
			throw new Error(
				`Invalid Vercel AI Gateway model slug "${persona.ai.model}". Use provider/model format (e.g. openai/gpt-5-mini). See https://vercel.com/docs/ai-gateway`,
			);
		}
		return;
	}

	if (persona.ai.model.includes("/")) {
		throw new Error(
			`OpenAI model id must not contain "/". Got "${persona.ai.model}".`,
		);
	}
}

export function normalizeModelOnProviderChange(
	newProvider: string,
	previousModel: string,
): string {
	const provider = getAIProvider(newProvider);
	if (!provider) {
		return previousModel;
	}

	if (provider.modelFormat === "gateway-slug") {
		if (GATEWAY_SLUG_RE.test(previousModel)) {
			return previousModel;
		}
		if (previousModel && !previousModel.includes("/")) {
			return `openai/${previousModel}`;
		}
		return provider.models[0] ?? "openai/gpt-5-mini";
	}

	if (previousModel.includes("/")) {
		const slash = previousModel.lastIndexOf("/");
		return previousModel.slice(slash + 1) || "gpt-5-mini";
	}

	return previousModel || "gpt-5-mini";
}

export function formatPersonaAiLabel(persona: Persona): string {
	if (persona.ai.provider === "vercel") {
		return persona.ai.model;
	}
	return `${persona.ai.provider}/${persona.ai.model}`;
}

function resolveOpenAiToken(): string {
	const creds = readCredentials();
	const token = creds.ai?.openai?.token?.trim();
	if (token) {
		return token;
	}
	throw new Error(
		"OpenAI API token not configured. Run `toby configure` to set it.",
	);
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

function assertVercelGatewayConfigured(): void {
	if (resolveVercelGatewayApiKey()) {
		return;
	}
	if (process.env.VERCEL_OIDC_TOKEN?.trim()) {
		return;
	}
	throw new Error(
		"Vercel AI Gateway API key not configured. Run `toby configure` to set it, or set AI_GATEWAY_API_KEY.",
	);
}

function createOpenAiModel(modelId: string): LanguageModel {
	const openai = createOpenAI({ apiKey: resolveOpenAiToken() });
	return openai(modelId);
}

function createVercelGatewayProvider() {
	assertVercelGatewayConfigured();
	const apiKey = resolveVercelGatewayApiKey();
	return createGateway({
		...(apiKey ? { apiKey } : {}),
		headers: buildAiGatewayAttributionHeaders(),
	});
}

function createVercelGatewayModel(modelId: string): LanguageModel {
	return createVercelGatewayProvider()(modelId);
}

export function resolveAuxiliaryModelId(
	providerId: string,
	override?: string,
): string {
	const fromEnv = process.env.TOBY_PRETREAT_MODEL?.trim();
	const raw = override ?? (fromEnv && fromEnv.length > 0 ? fromEnv : undefined);

	if (raw) {
		if (isGatewayModelSlug(raw)) {
			return raw;
		}
		if (providerId === "vercel") {
			return `openai/${raw}`;
		}
		return raw;
	}

	if (providerId === "vercel") {
		return VERCEL_AUX_DEFAULT;
	}
	return OPENAI_AUX_DEFAULT;
}

export function createModelForPersona(persona: Persona): LanguageModel {
	if (isReplaying()) {
		return createReplayModel(persona);
	}

	validatePersonaAi(persona);

	let model: LanguageModel;
	switch (persona.ai.provider) {
		case "openai":
			model = createOpenAiModel(persona.ai.model);
			break;
		case "vercel":
			model = createVercelGatewayModel(persona.ai.model);
			break;
		default:
			throw new Error(
				`Unsupported AI provider: ${persona.ai.provider}. Run \`toby configure\` to choose a supported provider.`,
			);
	}

	if (isRecording()) {
		return wrapLanguageModel({
			model: model as LanguageModelV3,
			middleware: createRecordMiddleware(),
		});
	}

	return model;
}

export function createModelForAuxiliary(options?: {
	readonly persona?: Persona;
	readonly modelId?: string;
}): LanguageModel {
	const persona = options?.persona ?? resolveDefaultPersona();
	const modelId = resolveAuxiliaryModelId(
		persona.ai.provider,
		options?.modelId,
	);
	return createModelForPersona({
		...persona,
		ai: { provider: persona.ai.provider, model: modelId },
	});
}
