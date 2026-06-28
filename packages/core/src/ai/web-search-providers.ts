/**
 * Registry of built-in web search providers.
 *
 * Each provider has a slightly different implementation. The AI Gateway
 * provider uses `gateway.tools.perplexitySearch()` — a provider-executed
 * tool that the Vercel AI Gateway runs server-side during model generation.
 * It reuses the existing Vercel AI Gateway API key (no new credentials).
 */
export interface WebSearchProviderInfo {
	readonly id: string;
	readonly displayName: string;
	readonly description: string;
}

export const WEB_SEARCH_PROVIDERS: readonly WebSearchProviderInfo[] = [
	{
		id: "ai-gateway",
		displayName: "AI Gateway (Perplexity)",
		description:
			"Uses the Vercel AI Gateway's built-in Perplexity search. Requires a Vercel AI Gateway API key (configured under AI settings). Web search is only active when the persona's AI provider is set to Vercel AI Gateway.",
	},
];

export function getWebSearchProvider(
	id: string,
): WebSearchProviderInfo | undefined {
	return WEB_SEARCH_PROVIDERS.find((p) => p.id === id);
}

export function listWebSearchProviderIds(): readonly string[] {
	return WEB_SEARCH_PROVIDERS.map((p) => p.id);
}
