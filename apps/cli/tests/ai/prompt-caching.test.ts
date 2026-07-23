import { describe, expect, it } from "bun:test";
import {
	applyChatMessageCaching,
	applyChatPromptCaching,
	extractTokenUsageReport,
	formatCacheDebugMeta,
	formatTokenUsageStatus,
} from "@toby/core/ai/caching";
import type { CoreMessage } from "@toby/core/ai/chat";
import type { Persona } from "@toby/core/config/index";
import type { LanguageModelUsage } from "ai";

function testPersona(ai: { provider: string; model: string }): Persona {
	return {
		name: "Test",
		instructions: "Be helpful",
		promptMode: "add",
		ai,
	};
}

describe("applyChatPromptCaching", () => {
	it("adds openai promptCacheKey for direct OpenAI", () => {
		const result = applyChatPromptCaching(undefined, {
			persona: testPersona({ provider: "openai", model: "gpt-4.1-mini" }),
			moduleNames: ["gmail", "todoist"],
		});
		const openai = result?.providerOptions?.openai as
			| Record<string, unknown>
			| undefined;
		expect(typeof openai?.promptCacheKey).toBe("string");
		expect(String(openai?.promptCacheKey)).toMatch(/^toby-chat-v/);
	});

	it("adds openai promptCacheKey and gateway auto caching for gateway openai models", () => {
		const result = applyChatPromptCaching(undefined, {
			persona: testPersona({
				provider: "vercel",
				model: "openai/gpt-4.1-mini",
			}),
			moduleNames: ["gmail"],
		});
		const openai = result?.providerOptions?.openai as
			| Record<string, unknown>
			| undefined;
		const gateway = result?.providerOptions?.gateway as
			| Record<string, unknown>
			| undefined;
		expect(typeof openai?.promptCacheKey).toBe("string");
		expect(gateway?.caching).toBe("auto");
	});

	it("enables gateway auto caching for anthropic gateway models", () => {
		const result = applyChatPromptCaching(undefined, {
			persona: testPersona({
				provider: "vercel",
				model: "anthropic/claude-sonnet-4.6",
			}),
			moduleNames: ["gmail"],
		});
		const gateway = result?.providerOptions?.gateway as
			| Record<string, unknown>
			| undefined;
		expect(gateway?.caching).toBe("auto");
	});

	it("preserves existing providerOptions when merging", () => {
		const result = applyChatPromptCaching(
			{
				providerOptions: {
					openai: { reasoningEffort: "low" },
				},
			},
			{
				persona: testPersona({ provider: "openai", model: "gpt-5-mini" }),
				moduleNames: [],
			},
		);
		const openai = result?.providerOptions?.openai as Record<string, unknown>;
		expect(openai.reasoningEffort).toBe("low");
		expect(typeof openai.promptCacheKey).toBe("string");
	});

	it("marks anthropic gateway system messages with cacheControl", () => {
		const messages: CoreMessage[] = [
			{ role: "system", content: "Stable policy" },
			{ role: "user", content: "Hello" },
		];
		const out = applyChatMessageCaching(messages, {
			persona: testPersona({
				provider: "vercel",
				model: "anthropic/claude-sonnet-4.6",
			}),
			moduleNames: [],
		});
		const system = out[0];
		expect(system?.role).toBe("system");
		const anthropic = system?.providerOptions?.anthropic as
			| Record<string, unknown>
			| undefined;
		expect(anthropic?.cacheControl).toEqual({ type: "ephemeral" });
	});

	it("uses stable cache keys for the same persona and modules", () => {
		const context = {
			persona: testPersona({ provider: "openai", model: "gpt-4.1-mini" }),
			moduleNames: ["todoist", "gmail"] as const,
		};
		const a = applyChatPromptCaching(undefined, context);
		const b = applyChatPromptCaching(undefined, context);
		const keyA = (a?.providerOptions?.openai as Record<string, unknown>)
			.promptCacheKey;
		const keyB = (b?.providerOptions?.openai as Record<string, unknown>)
			.promptCacheKey;
		expect(keyA).toBe(keyB);
	});
});

describe("token usage reporting", () => {
	const usage: LanguageModelUsage = {
		inputTokens: 100,
		outputTokens: 10,
		totalTokens: 110,
		inputTokenDetails: {
			noCacheTokens: 40,
			cacheReadTokens: 60,
			cacheWriteTokens: 0,
		},
		outputTokenDetails: {
			textTokens: 10,
			reasoningTokens: 0,
		},
	};

	it("normalizes LanguageModelUsage into TokenUsageReport", () => {
		const report = extractTokenUsageReport(usage, {
			persona: testPersona({
				provider: "vercel",
				model: "openai/gpt-4.1-mini",
			}),
		});
		expect(report).toEqual({
			providerId: "vercel",
			model: "openai/gpt-4.1-mini",
			inputTokens: 100,
			outputTokens: 10,
			totalTokens: 110,
			cacheReadTokens: 60,
			cacheWriteTokens: 0,
			noCacheTokens: 40,
		});
	});

	it("formats status line with cache read and write", () => {
		const report = extractTokenUsageReport(
			{
				...usage,
				inputTokenDetails: {
					noCacheTokens: 90,
					cacheReadTokens: 0,
					cacheWriteTokens: 10,
				},
			},
			{
				persona: testPersona({ provider: "openai", model: "gpt-4.1-mini" }),
			},
		);
		expect(formatTokenUsageStatus(report)).toBe(
			"in=100 out=10 tot=110 cache=0 cacheW=10",
		);
	});

	it("fills cache read tokens from raw usage when SDK details are missing", () => {
		const report = extractTokenUsageReport(
			{
				inputTokens: 100,
				outputTokens: 5,
				totalTokens: 105,
				inputTokenDetails: {
					noCacheTokens: 100,
					cacheReadTokens: undefined,
					cacheWriteTokens: undefined,
				},
				outputTokenDetails: {
					textTokens: 5,
					reasoningTokens: 0,
				},
				raw: {
					prompt_tokens_details: { cached_tokens: 42 },
				},
			},
			{
				persona: testPersona({
					provider: "vercel",
					model: "openai/gpt-4.1-mini",
				}),
			},
		);
		expect(report?.cacheReadTokens).toBe(42);
	});

	it("formats debug cache meta", () => {
		const report = extractTokenUsageReport(usage, {
			persona: testPersona({ provider: "openai", model: "gpt-4.1-mini" }),
		});
		expect(report).not.toBeNull();
		if (!report) {
			return;
		}
		expect(formatCacheDebugMeta(report)).toBe(
			"cacheRead=60 · cacheWrite=0 · noCache=40",
		);
	});
});
