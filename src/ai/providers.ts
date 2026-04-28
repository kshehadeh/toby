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
];
