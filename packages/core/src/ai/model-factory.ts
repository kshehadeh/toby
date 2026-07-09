import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { type LanguageModel, wrapLanguageModel } from "ai";
import { readConfig, readCredentials } from "../config/index";
import type { Persona } from "../config/index";
import { resolveDefaultPersona } from "../personas/index";
import { AI_PROVIDERS, getAIProvider } from "./providers";
import {
	createRecordMiddleware,
	createReplayModel,
	isRecording,
	isReplaying,
} from "./replay";

const GATEWAY_SLUG_RE = /^[a-z0-9-]+\/[a-z0-9][a-z0-9.-]*$/i;

const OPENAI_AUX_DEFAULT = "gpt-4.1-nano";
const VERCEL_AUX_DEFAULT = "openai/gpt-4.1-nano";
const OLLAMA_AUX_DEFAULT = "llama3.2";

/** Default base URL for a local Ollama server's OpenAI-compatible API. */
export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";

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

/**
 * Returns true when the given provider has credentials/settings configured
 * (from credentials file or environment variables).
 * Does not expose secret values.
 */
export function isAIProviderConfigured(providerId: string): boolean {
	switch (providerId) {
		case "openai": {
			const token = readCredentials().ai?.openai?.token?.trim();
			return Boolean(token);
		}
		case "vercel": {
			const credsKey = readCredentials().ai?.vercel?.apiKey?.trim();
			const envKey = process.env.AI_GATEWAY_API_KEY?.trim();
			const oidc = process.env.VERCEL_OIDC_TOKEN?.trim();
			return Boolean(credsKey || (envKey && envKey.length > 0) || oidc);
		}
		case "ollama": {
			const credsKey = readCredentials().ai?.ollama?.apiKey?.trim();
			const envKey = process.env.OLLAMA_API_KEY?.trim();
			const envBaseUrl = process.env.TOBY_OLLAMA_BASE_URL?.trim();
			const configBaseUrl = readConfig().ai?.ollama?.baseUrl?.trim();
			return Boolean(
				credsKey ||
					(envKey && envKey.length > 0) ||
					(envBaseUrl && envBaseUrl.length > 0) ||
					(configBaseUrl && configBaseUrl.length > 0),
			);
		}
		default:
			return false;
	}
}

/** Returns true when at least one AI provider has credentials configured. */
export function hasAnyConfiguredAIProvider(): boolean {
	return AI_PROVIDERS.some((p) => isAIProviderConfigured(p.id));
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

	if (provider.modelFormat === "ollama-id") {
		if (!persona.ai.model.trim()) {
			throw new Error(
				"Ollama model name is required (e.g. llama3.2). Run `toby configure` to set it.",
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

	if (provider.modelFormat === "ollama-id") {
		if (previousModel.includes("/")) {
			const slash = previousModel.lastIndexOf("/");
			return (
				previousModel.slice(slash + 1) ||
				provider.models[0] ||
				OLLAMA_AUX_DEFAULT
			);
		}
		return previousModel || provider.models[0] || OLLAMA_AUX_DEFAULT;
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

export function createVercelGatewayModel(modelId: string): LanguageModel {
	return createVercelGatewayProvider()(modelId);
}

/** Resolve the Ollama OpenAI-compatible base URL (env > config > default). */
export function resolveOllamaBaseUrl(): string {
	const fromEnv = process.env.TOBY_OLLAMA_BASE_URL?.trim();
	if (fromEnv) {
		return fromEnv;
	}
	const fromConfig = readConfig().ai?.ollama?.baseUrl?.trim();
	if (fromConfig) {
		return fromConfig;
	}
	return OLLAMA_DEFAULT_BASE_URL;
}

/** Optional API key for protected/remote Ollama-compatible endpoints. */
export function resolveOllamaApiKey(): string | undefined {
	const fromCreds = readCredentials().ai?.ollama?.apiKey?.trim();
	if (fromCreds) {
		return fromCreds;
	}
	const fromEnv = process.env.OLLAMA_API_KEY?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

export function createOllamaProvider() {
	const apiKey = resolveOllamaApiKey();
	return createOpenAICompatible({
		name: "ollama",
		baseURL: resolveOllamaBaseUrl(),
		...(apiKey ? { apiKey } : {}),
	});
}

function createOllamaModel(modelId: string): LanguageModel {
	return createOllamaProvider().chatModel(modelId);
}

export function resolveAuxiliaryModelId(
	providerId: string,
	override?: string,
): string {
	const fromEnv = process.env.TOBY_PRETREAT_MODEL?.trim();
	const raw = override ?? (fromEnv && fromEnv.length > 0 ? fromEnv : undefined);

	if (raw) {
		if (providerId === "ollama") {
			return raw;
		}
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
	if (providerId === "ollama") {
		return OLLAMA_AUX_DEFAULT;
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
		case "ollama":
			model = createOllamaModel(persona.ai.model);
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
