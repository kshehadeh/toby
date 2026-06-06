import type { LanguageModelUsage } from "ai";
import type { Persona } from "../../config/index";
import type { CoreMessage } from "../chat";

/** Context passed from the chat orchestrator into provider cache adapters. */
export type ChatCacheContext = {
	readonly persona: Persona;
	readonly moduleNames: readonly string[];
	readonly promptSchemaVersion?: string;
};

/** Provider-specific `providerOptions` patch merged into `chatWithTools`. */
export type CacheProviderOptionsPatch = Record<string, unknown>;

/**
 * Normalized token + cache telemetry returned to the orchestrator and UI.
 * All providers map AI SDK `LanguageModelUsage` into this shape.
 */
export type TokenUsageReport = {
	readonly providerId: string;
	readonly model: string;
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly totalTokens?: number;
	readonly cacheReadTokens?: number;
	readonly cacheWriteTokens?: number;
	readonly noCacheTokens?: number;
};

export type ApplyCacheHintsParams = ChatCacheContext & {
	readonly existingProviderOptions?: Record<string, unknown>;
};

export type NormalizeUsageParams = ChatCacheContext & {
	readonly usage: LanguageModelUsage;
};

export type ApplyMessageCacheHintsParams = ChatCacheContext & {
	readonly messages: readonly CoreMessage[];
};

/**
 * Per AI provider: configure prompt caching and optional usage interpretation.
 */
export interface CacheAdapter {
	readonly providerId: string;
	applyProviderOptions(
		params: ApplyCacheHintsParams,
	): CacheProviderOptionsPatch | undefined;
	/** Optional message-level cache breakpoints (e.g. Anthropic `cacheControl`). */
	applyMessageCacheHints?(params: ApplyMessageCacheHintsParams): CoreMessage[];
	normalizeUsageReport?(params: NormalizeUsageParams): TokenUsageReport;
}
