import type { ChatWithToolsOptions, CoreMessage } from "../chat";
import { getCacheAdapter } from "./registry";
import { asProviderOptionsRecord } from "./shared";
import type { ChatCacheContext } from "./types";

export type {
	CacheAdapter,
	CacheProviderOptionsPatch,
	ChatCacheContext,
	TokenUsageReport,
} from "./types";
export { DEFAULT_CHAT_PROMPT_SCHEMA_VERSION } from "./shared";
export { getCacheAdapter, listCacheAdapters } from "./registry";
export {
	extractTokenUsageReport,
	formatCacheDebugMeta,
	formatTokenUsageStatus,
} from "./usage";

/**
 * Applies provider-specific prompt caching options before a model turn.
 * Each registered {@link CacheAdapter} merges its own `providerOptions` patch.
 */
/** Applies provider-specific message cache breakpoints before a model turn. */
export function applyChatMessageCaching(
	messages: readonly CoreMessage[],
	context: ChatCacheContext,
): CoreMessage[] {
	const adapter = getCacheAdapter(context.persona.ai.provider);
	if (!adapter?.applyMessageCacheHints) {
		return [...messages];
	}
	return adapter.applyMessageCacheHints({ ...context, messages });
}

export function applyChatPromptCaching(
	chatWithToolsOptions: ChatWithToolsOptions | undefined,
	context: ChatCacheContext,
): ChatWithToolsOptions | undefined {
	const adapter = getCacheAdapter(context.persona.ai.provider);
	if (!adapter) {
		return chatWithToolsOptions;
	}

	const existing = asProviderOptionsRecord(
		chatWithToolsOptions?.providerOptions,
	);
	const patch = adapter.applyProviderOptions({
		...context,
		existingProviderOptions: existing,
	});
	if (!patch) {
		return chatWithToolsOptions;
	}

	return {
		...chatWithToolsOptions,
		providerOptions: patch,
	};
}
