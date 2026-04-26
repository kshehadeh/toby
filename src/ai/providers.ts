interface AIProviderInfo {
	id: string;
	displayName: string;
	models: string[];
}

export const AI_PROVIDERS: AIProviderInfo[] = [
	{
		id: "openai",
		displayName: "OpenAI",
		models: [
			"gpt-4o",
			"gpt-4o-mini",
			"gpt-4.1",
			"gpt-4.1-mini",
			"gpt-4.1-nano",
			"o3",
			"o4-mini",
		],
	},
];

function getProvider(id: string): AIProviderInfo | undefined {
	return AI_PROVIDERS.find((p) => p.id === id);
}

function getProviderModels(providerId: string): string[] {
	return getProvider(providerId)?.models ?? [];
}
