/** A single model option for persona / settings pickers. */
export type AIModelListItem = {
	readonly id: string;
	readonly displayName?: string;
	readonly contextWindowTokens?: number;
	readonly ownedBy?: string;
	/**
	 * True when the provider catalog marks this as a reasoning model
	 * (e.g. Vercel `tags` includes `"reasoning"`, OpenRouter `reasoning` object).
	 * Omitted when the catalog does not expose that signal.
	 */
	readonly reasoning?: boolean;
	/**
	 * True when the provider catalog says the model supports schema-constrained
	 * structured output (OpenRouter `supported_parameters: structured_outputs`,
	 * Vercel tag `structured-output`, Chutes `supported_features`, or the curated
	 * OpenAI family list). Omitted = unknown, which callers must treat as
	 * unsupported.
	 */
	readonly structuredOutput?: boolean;
};

/** Normalized model list for one AI provider. */
export type AIProviderModelList = {
	readonly providerId: string;
	/** True when a remote listing was attempted (provider is configured). */
	readonly remote: boolean;
	readonly models: readonly AIModelListItem[];
	readonly unavailableReason?: string;
	readonly fetchedAt: string;
};

/** Per AI provider: fetch available models from the provider API. */
export interface ModelListAdapter {
	readonly providerId: string;
	/** Only called when the provider is already configured. */
	fetchModels(): Promise<AIProviderModelList>;
}

/** Label shown in model pickers (settings tree, persona editor, API clients). */
export function formatModelChoiceLabel(
	item: Pick<AIModelListItem, "id" | "reasoning">,
): string {
	const id = item.id.trim();
	if (!id) return id;
	return item.reasoning ? `${id} · reasoning` : id;
}

/**
 * Whether a model may be used where schema-constrained output is required
 * (e.g. The Feed). Unknown capability is treated as unsupported.
 */
export function modelSupportsStructuredOutput(
	item: Pick<AIModelListItem, "structuredOutput"> | undefined,
): boolean {
	return item?.structuredOutput === true;
}
