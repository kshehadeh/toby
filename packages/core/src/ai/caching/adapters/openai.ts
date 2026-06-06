import {
	asProviderOptionsRecord,
	mergeProviderOptions,
	openAiPromptCacheKeyPatch,
} from "../shared";
import type { CacheAdapter } from "../types";

export const openAiCacheAdapter: CacheAdapter = {
	providerId: "openai",

	applyProviderOptions(params) {
		const existing = asProviderOptionsRecord(params.existingProviderOptions);
		const existingOpenAi = asProviderOptionsRecord(existing?.openai);
		const keyPatch = openAiPromptCacheKeyPatch(params).openai as Record<
			string,
			unknown
		>;
		return mergeProviderOptions(existing ?? {}, {
			openai: {
				...(existingOpenAi ?? {}),
				...keyPatch,
			},
		});
	},
};
