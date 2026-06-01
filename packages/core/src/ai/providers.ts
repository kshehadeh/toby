export type AIProviderModelFormat = "openai-id" | "gateway-slug";

export interface AIProviderInfo {
	id: string;
	displayName: string;
	modelFormat: AIProviderModelFormat;
	models: string[];
	allowCustomModel?: boolean;
}

export const AI_PROVIDERS: AIProviderInfo[] = [
	{
		id: "openai",
		displayName: "OpenAI",
		modelFormat: "openai-id",
		models: [
			"gpt-5",
			"gpt-5-mini",
			"gpt-5-nano",
			"gpt-4o",
			"gpt-4o-mini",
			"gpt-4.1",
			"gpt-4.1-mini",
			"gpt-4.1-nano",
			"o3",
			"o4-mini",
		],
	},
	{
		id: "vercel",
		displayName: "Vercel AI Gateway",
		modelFormat: "gateway-slug",
		allowCustomModel: true,
		models: [
			"openai/gpt-5.4",
			"openai/gpt-5-mini",
			"openai/gpt-5-nano",
			"openai/gpt-4.1-mini",
			"anthropic/claude-sonnet-4.6",
			"anthropic/claude-haiku-4.5",
			"anthropic/claude-opus-4.6",
			"google/gemini-3-flash",
			"google/gemini-2.5-flash",
			"google/gemini-2.5-pro",
			"amazon/nova-lite",
			"meta/llama-4-scout",
			"mistral/mistral-medium",
			"deepseek/deepseek-v3.2",
			"xai/grok-4-fast-reasoning",
			"zai/glm-5.1",
			"zai/glm-4.7",
			"zai/glm-4.7-flash",
			"moonshotai/kimi-k2.6",
			"moonshotai/kimi-k2.5",
		],
	},
];

export function getAIProvider(id: string): AIProviderInfo | undefined {
	return AI_PROVIDERS.find((p) => p.id === id);
}

export function getAIProviderDisplayName(id: string): string {
	return getAIProvider(id)?.displayName ?? id;
}
