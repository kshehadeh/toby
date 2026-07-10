export type AIProviderModelFormat =
	| "openai-id"
	| "gateway-slug"
	| "ollama-id"
	| "chutes-id"
	| "openrouter-id";

export interface AIProviderInfo {
	id: string;
	displayName: string;
	modelFormat: AIProviderModelFormat;
	models: string[];
	allowCustomModel?: boolean;
	/** Provider exposes plan spend / remaining balance via billing API. */
	supportsPlanUsage?: boolean;
	/** Model catalog endpoint is accessible without credentials. */
	publicCatalog?: boolean;
}

export const AI_PROVIDERS: AIProviderInfo[] = [
	{
		id: "openai",
		displayName: "OpenAI",
		modelFormat: "openai-id",
		supportsPlanUsage: false,
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
		supportsPlanUsage: true,
		models: [
			"openai/gpt-5.4",
			"openai/gpt-5-mini",
			"openai/gpt-5-nano",
			"openai/gpt-4.1-mini",
			"openai/o4-mini",
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
	{
		id: "ollama",
		displayName: "Ollama",
		modelFormat: "ollama-id",
		allowCustomModel: true,
		supportsPlanUsage: false,
		models: [
			"llama3.2",
			"llama3.1",
			"qwen2.5-coder",
			"mistral",
			"deepseek-r1",
			"gemma3",
		],
	},
	{
		id: "chutes",
		displayName: "Chutes",
		modelFormat: "chutes-id",
		allowCustomModel: true,
		supportsPlanUsage: false,
		publicCatalog: true,
		models: [
			"Qwen/Qwen3-32B-TEE",
			"google/gemma-4-31B-turbo-TEE",
			"Qwen/Qwen3.5-397B-A17B-TEE",
			"Qwen/Qwen3.6-27B-TEE",
			"deepseek-ai/DeepSeek-V3.2-TEE",
			"zai-org/GLM-5.2-TEE",
			"zai-org/GLM-5.1-TEE",
			"moonshotai/Kimi-K2.6-TEE",
			"MiniMaxAI/MiniMax-M2.5-TEE",
			"Qwen/Qwen3-235B-A22B-Thinking-2507-TEE",
			"moonshotai/Kimi-K2.5-TEE",
			"unsloth/Mistral-Nemo-Instruct-2407-TEE",
			"zai-org/GLM-5-TEE",
		],
	},
	{
		id: "openrouter",
		displayName: "OpenRouter",
		modelFormat: "openrouter-id",
		allowCustomModel: true,
		supportsPlanUsage: false,
		publicCatalog: true,
		models: [
			"openai/gpt-5.6-sol",
			"openai/gpt-5.6-terra",
			"openai/gpt-5.6-luna",
			"anthropic/claude-sonnet-4.6",
			"anthropic/claude-haiku-4.5",
			"google/gemini-3-pro",
			"google/gemini-3-flash",
			"meta-llama/llama-4-maverick",
			"deepseek/deepseek-v3.2",
			"xai/grok-4",
		],
	},
];

export function getAIProvider(id: string): AIProviderInfo | undefined {
	return AI_PROVIDERS.find((p) => p.id === id);
}

export function getAIProviderDisplayName(id: string): string {
	return getAIProvider(id)?.displayName ?? id;
}
