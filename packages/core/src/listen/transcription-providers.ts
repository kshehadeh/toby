import { readConfig, readCredentials } from "../config/index";

export interface TranscriptionProviderInfo {
	readonly id: string;
	readonly displayName: string;
	readonly models: readonly string[];
	/**
	 * When true, the provider reuses the shared OpenAI API token
	 * (`credentials.ai.openai.token`) if no transcription-specific key is set.
	 */
	readonly reusesOpenAiToken?: boolean;
	/**
	 * When true, the provider reuses the shared Vercel AI Gateway API key
	 * (`credentials.ai.vercel.apiKey` or `AI_GATEWAY_API_KEY`) if no
	 * transcription-specific key is set.
	 */
	readonly reusesVercelApiKey?: boolean;
	/**
	 * When true, the provider reuses the shared OpenRouter API key
	 * (`credentials.ai.openrouter.apiKey` or `OPENROUTER_API_KEY`) if no
	 * transcription-specific key is set.
	 */
	readonly reusesOpenRouterApiKey?: boolean;
	/**
	 * When true, the provider allows custom model IDs not in the built-in list.
	 */
	readonly allowCustomModel?: boolean;
}

export const TRANSCRIPTION_PROVIDERS: readonly TranscriptionProviderInfo[] = [
	{
		id: "openai",
		displayName: "OpenAI",
		reusesOpenAiToken: true,
		models: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
	},
	{
		id: "groq",
		displayName: "Groq",
		models: ["whisper-large-v3-turbo", "whisper-large-v3"],
	},
	{
		id: "vercel",
		displayName: "Vercel AI Gateway",
		reusesVercelApiKey: true,
		allowCustomModel: true,
		models: [
			"openai/whisper-1",
			"openai/gpt-4o-mini-transcribe",
			"openai/gpt-4o-transcribe",
			"xai/grok-stt",
		],
	},
	{
		id: "openrouter",
		displayName: "OpenRouter",
		reusesOpenRouterApiKey: true,
		allowCustomModel: true,
		// Live list from Models API (`output_modalities=transcription`); these are fallbacks.
		models: [
			"openai/whisper-1",
			"openai/whisper-large-v3",
			"openai/gpt-4o-mini-transcribe",
			"openai/gpt-4o-transcribe",
			"mistralai/voxtral-mini-transcribe",
			"deepgram/nova-3",
		],
	},
];

export function getTranscriptionProvider(
	id: string,
): TranscriptionProviderInfo | undefined {
	return TRANSCRIPTION_PROVIDERS.find((p) => p.id === id);
}

export function listTranscriptionProviderIds(): readonly string[] {
	return TRANSCRIPTION_PROVIDERS.map((p) => p.id);
}

export interface TranscriptionSelection {
	readonly provider: string;
	readonly model: string;
	readonly apiKey: string;
}

export function resolveTranscriptionApiKey(
	providerId: string,
	creds: ReturnType<typeof readCredentials> = readCredentials(),
): string | undefined {
	const specific = creds.transcription?.[providerId]?.apiKey?.trim();
	if (specific) return specific;
	if (providerId === "openai") {
		return creds.ai?.openai?.token?.trim() || undefined;
	}
	if (providerId === "vercel") {
		const fromCreds = creds.ai?.vercel?.apiKey?.trim();
		if (fromCreds) return fromCreds;
		const fromEnv = process.env.AI_GATEWAY_API_KEY?.trim();
		if (fromEnv && fromEnv.length > 0) return fromEnv;
		// OIDC-only: gateway works without an API key when VERCEL_OIDC_TOKEN is set.
		if (process.env.VERCEL_OIDC_TOKEN?.trim()) return "";
		return undefined;
	}
	if (providerId === "groq") {
		const fromEnv = process.env.GROQ_API_KEY?.trim();
		if (fromEnv && fromEnv.length > 0) return fromEnv;
		return undefined;
	}
	if (providerId === "openrouter") {
		const fromCreds = creds.ai?.openrouter?.apiKey?.trim();
		if (fromCreds) return fromCreds;
		const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
		if (fromEnv && fromEnv.length > 0) return fromEnv;
		return undefined;
	}
	return undefined;
}

/** Non-secret diagnostics for Settings / onboarding (no key material). */
export function getTranscriptionSetupStatus(): {
	readonly configured: boolean;
	readonly provider?: string;
	readonly model?: string;
	readonly hasProviderAndModel: boolean;
	readonly hasApiKey: boolean;
	readonly needsApiKey: boolean;
	readonly statusMessage: string;
} {
	const config = readConfig();
	const provider = config.transcription?.provider?.trim();
	const model = config.transcription?.model?.trim();
	const hasProviderAndModel = Boolean(provider && model);
	const info = provider ? getTranscriptionProvider(provider) : undefined;
	const hasApiKey = provider
		? resolveTranscriptionApiKey(provider) !== undefined
		: false;
	const configured = Boolean(info && hasProviderAndModel && hasApiKey);
	const displayName = info?.displayName ?? provider ?? "transcription";

	let statusMessage: string;
	if (configured) {
		statusMessage = `Transcription is ready (${displayName}${model ? ` / ${model}` : ""}).`;
	} else if (hasProviderAndModel && !hasApiKey) {
		statusMessage = `${displayName} is selected, but no API key is available. Paste a key below${
			info?.reusesOpenAiToken ||
			info?.reusesVercelApiKey ||
			info?.reusesOpenRouterApiKey
				? ", or configure it under Settings → AI"
				: ""
		}. Until a key is set, Toby treats transcription as not configured.`;
	} else if (hasProviderAndModel) {
		statusMessage =
			"Transcription provider and model are set, but setup is incomplete.";
	} else {
		statusMessage =
			"Choose a transcription provider and model. OpenAI and Vercel can reuse AI keys; Groq and OpenRouter need their own keys.";
	}

	return {
		configured,
		provider: provider || undefined,
		model: model || undefined,
		hasProviderAndModel,
		hasApiKey,
		needsApiKey: hasProviderAndModel && !hasApiKey,
		statusMessage,
	};
}

export function resolveTranscriptionSelection():
	| TranscriptionSelection
	| undefined {
	const config = readConfig();
	const provider = config.transcription?.provider?.trim();
	const model = config.transcription?.model?.trim();
	if (!provider || !model) return undefined;
	const info = getTranscriptionProvider(provider);
	if (!info) return undefined;
	const apiKey = resolveTranscriptionApiKey(provider);
	if (apiKey === undefined) return undefined;
	return { provider, model, apiKey };
}

export function isTranscriptionConfigured(): boolean {
	return resolveTranscriptionSelection() !== undefined;
}
