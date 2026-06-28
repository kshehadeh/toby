/**
 * Registry of built-in web search providers.
 *
 * The AI Gateway provider uses `gateway.tools.perplexitySearch()` invoked
 * through a lightweight `generateText` call with `openai/gpt-4.1-mini` on
 * the Vercel AI Gateway. The `webSearch` tool is a client-side function
 * tool whose `execute` runs that call, so it works with any persona AI
 * provider (not just the gateway). It reuses the existing Vercel AI
 * Gateway API key (no new credentials).
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
			"Uses the Vercel AI Gateway's built-in Perplexity search. Requires a Vercel AI Gateway API key (configured under AI settings). Works with any persona AI provider.",
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
