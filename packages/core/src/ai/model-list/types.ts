/** A single model option for persona / settings pickers. */
export type AIModelListItem = {
	readonly id: string;
	readonly displayName?: string;
	readonly contextWindowTokens?: number;
	readonly ownedBy?: string;
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
