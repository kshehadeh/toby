import { mock } from "bun:test";
import * as actualEmbeddings from "@toby/core/routing/embeddings";
import * as actualModelFactory from "@toby/core/ai/model-factory";
import { getDb } from "@toby/core/session-store";
import * as actualAi from "ai";

export const generateTextQueue: unknown[] = [];
export const generateTextMock = mock((..._args: unknown[]) => {
	const value = generateTextQueue.shift();
	if (value instanceof Promise) return value;
	return Promise.resolve(value ?? {});
});

export const embedTextsQueue: unknown[] = [];
export const embedTextsMock = mock((..._args: unknown[]) => {
	const value = embedTextsQueue.shift();
	return Promise.resolve(value ?? []);
});

mock.module("ai", () => ({
	...actualAi,
	generateText: (...args: unknown[]) => generateTextMock(...args),
}));

mock.module("@toby/core/routing/embeddings", () => ({
	...actualEmbeddings,
	embedTexts: (...args: unknown[]) => embedTextsMock(...args),
	createEmbeddingModelForPersona: () => ({}) as never,
}));

mock.module("@toby/core/ai/model-factory", () => ({
	...actualModelFactory,
	createModelForAuxiliary: () => ({}) as never,
}));

/** Clear the pretreatment cache so tests that call wrapUserPromptWithPretreatment
 *  always hit the LLM/embedding mocks instead of a cached result.
 *  This is needed because the cache is active under Bun (globalThis.Bun is defined)
 *  but was inactive under Node/vitest.
 */
export function clearPretreatmentCache(): void {
	try {
		getDb().exec("DELETE FROM chat_pretreatment_cache");
	} catch {
		// Table may not exist yet; ignore.
	}
}
