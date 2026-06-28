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
	return undefined;
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
	if (!apiKey) return undefined;
	return { provider, model, apiKey };
}

export function isTranscriptionConfigured(): boolean {
	return resolveTranscriptionSelection() !== undefined;
}
