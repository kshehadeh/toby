import {
	clearModelListCache,
	fetchAIProviderModels,
	isOpenAiChatModelId,
	resolveAIProvidersForUI,
	uniqueModelItems,
} from "@toby/core/ai/model-list";
import { AI_PROVIDERS } from "@toby/core/ai/providers";
import {
	readCredentials,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir: string;
let originalTobyDir: string | undefined;
let originalFetch: typeof globalThis.fetch | undefined;
let originalGatewayKey: string | undefined;

function emptyConfig(
	overrides: {
		ai?: {
			ollama?: { baseUrl?: string };
			customModels?: Record<string, string[]>;
		};
	} = {},
) {
	return {
		integrations: {},
		personas: [] as [],
		...overrides,
	};
}

function withTempEnv() {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-model-list-"));
	originalTobyDir = process.env.TOBY_DIR;
	process.env.TOBY_DIR = tempDir;
	writeConfig(emptyConfig());
	writeCredentials({});
}

function restoreEnv() {
	if (originalTobyDir !== undefined) {
		process.env.TOBY_DIR = originalTobyDir;
	} else {
		Reflect.deleteProperty(process.env, "TOBY_DIR");
	}
	if (tempDir && fs.existsSync(tempDir)) {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
	if (originalFetch) {
		globalThis.fetch = originalFetch;
		originalFetch = undefined;
	}
	if (originalGatewayKey !== undefined) {
		if (originalGatewayKey) {
			process.env.AI_GATEWAY_API_KEY = originalGatewayKey;
		} else {
			Reflect.deleteProperty(process.env, "AI_GATEWAY_API_KEY");
		}
		originalGatewayKey = undefined;
	}
	clearModelListCache();
}

beforeEach(() => {
	clearModelListCache();
	withTempEnv();
});

afterEach(() => {
	restoreEnv();
});

describe("isOpenAiChatModelId", () => {
	it("keeps chat models and drops embeddings / audio", () => {
		expect(isOpenAiChatModelId("gpt-5-mini")).toBe(true);
		expect(isOpenAiChatModelId("o4-mini")).toBe(true);
		expect(isOpenAiChatModelId("chatgpt-4o-latest")).toBe(true);
		expect(isOpenAiChatModelId("text-embedding-3-small")).toBe(false);
		expect(isOpenAiChatModelId("whisper-1")).toBe(false);
		expect(isOpenAiChatModelId("tts-1")).toBe(false);
		expect(isOpenAiChatModelId("dall-e-3")).toBe(false);
	});
});

describe("uniqueModelItems", () => {
	it("de-dupes by id preserving first occurrence", () => {
		expect(
			uniqueModelItems([
				{ id: "a" },
				{ id: "b" },
				{ id: "a" },
				{ id: " b " },
			]).map((m) => m.id),
		).toEqual(["a", "b"]);
	});
});

describe("fetchAIProviderModels", () => {
	it("returns curated models without network when unconfigured", async () => {
		originalFetch = globalThis.fetch;
		const fetchMock = mock(() => {
			throw new Error("should not fetch");
		});
		globalThis.fetch = fetchMock as typeof globalThis.fetch;

		const list = await fetchAIProviderModels("openai");
		expect(list.remote).toBe(false);
		expect(list.unavailableReason).toContain("not configured");
		expect(list.models.map((m) => m.id)).toEqual(
			AI_PROVIDERS.find((p) => p.id === "openai")?.models ?? [],
		);
		expect(fetchMock).toHaveBeenCalledTimes(0);
	});

	it("fetches and filters OpenAI models when configured", async () => {
		writeCredentials({
			ai: { openai: { token: "sk-test" } },
		});
		// re-read to ensure credentials path works
		expect(readCredentials().ai?.openai?.token).toBe("sk-test");

		originalFetch = globalThis.fetch;
		const fetchMock = mock().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [
						{ id: "gpt-5-mini", owned_by: "openai" },
						{ id: "text-embedding-3-small", owned_by: "openai" },
						{ id: "whisper-1", owned_by: "openai" },
						{ id: "o4-mini", owned_by: "openai" },
						{ id: "gpt-4.1-nano", owned_by: "openai" },
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);
		globalThis.fetch = fetchMock as typeof globalThis.fetch;

		const list = await fetchAIProviderModels("openai");
		expect(list.remote).toBe(true);
		expect(list.unavailableReason).toBeUndefined();
		// Provider order preserved; curated list is not merged in.
		expect(list.models.map((m) => m.id)).toEqual([
			"gpt-5-mini",
			"o4-mini",
			"gpt-4.1-nano",
		]);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// cache
		await fetchAIProviderModels("openai");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("soft-falls back to curated OpenAI models on API error", async () => {
		writeCredentials({
			ai: { openai: { token: "sk-test" } },
		});
		originalFetch = globalThis.fetch;
		globalThis.fetch = mock().mockResolvedValue(
			new Response(JSON.stringify({ error: { message: "boom" } }), {
				status: 500,
			}),
		) as typeof globalThis.fetch;

		const list = await fetchAIProviderModels("openai");
		expect(list.remote).toBe(true);
		expect(list.unavailableReason).toContain("500");
		expect(list.models.length).toBeGreaterThan(0);
		expect(list.models[0]?.id).toBe(
			AI_PROVIDERS.find((p) => p.id === "openai")?.models[0],
		);
	});

	it("fetches Vercel language models when gateway is configured", async () => {
		originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
		process.env.AI_GATEWAY_API_KEY = "gateway-test";

		originalFetch = globalThis.fetch;
		const fetchMock = mock().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [
						{
							id: "openai/gpt-5-mini",
							type: "language",
							context_window: 128000,
						},
						{
							id: "openai/text-embedding-3-small",
							type: "embedding",
							context_window: 8192,
						},
						{
							id: "anthropic/claude-sonnet-4.6",
							type: "language",
							context_window: 200000,
						},
						{ id: "xai/grok-new", type: "language", context_window: 131072 },
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);
		globalThis.fetch = fetchMock as typeof globalThis.fetch;

		const list = await fetchAIProviderModels("vercel");
		expect(list.remote).toBe(true);
		const ids = list.models.map((m) => m.id);
		expect(ids).toContain("openai/gpt-5-mini");
		expect(ids).toContain("anthropic/claude-sonnet-4.6");
		expect(ids).toContain("xai/grok-new");
		expect(ids).not.toContain("openai/text-embedding-3-small");
	});

	it("fetches Ollama models when base URL is configured", async () => {
		writeConfig(
			emptyConfig({
				ai: { ollama: { baseUrl: "http://127.0.0.1:11434/v1" } },
			}),
		);

		originalFetch = globalThis.fetch;
		const fetchMock = mock().mockImplementation(async (input: RequestInfo) => {
			const url = String(input);
			expect(url).toContain("/v1/models");
			return new Response(
				JSON.stringify({
					data: [
						{ id: "llama3.2", owned_by: "library" },
						{ id: "custom-local", owned_by: "library" },
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		globalThis.fetch = fetchMock as typeof globalThis.fetch;

		const list = await fetchAIProviderModels("ollama");
		expect(list.remote).toBe(true);
		const ids = list.models.map((m) => m.id);
		expect(ids).toContain("llama3.2");
		expect(ids).toContain("custom-local");
	});

	it("soft-falls back when Ollama is unreachable", async () => {
		writeConfig(
			emptyConfig({
				ai: { ollama: { baseUrl: "http://127.0.0.1:11434/v1" } },
			}),
		);
		originalFetch = globalThis.fetch;
		globalThis.fetch = mock().mockRejectedValue(
			new Error("connection refused"),
		) as typeof globalThis.fetch;

		const list = await fetchAIProviderModels("ollama");
		expect(list.remote).toBe(true);
		expect(list.unavailableReason).toContain("connection refused");
		expect(list.models.map((m) => m.id)).toEqual(
			AI_PROVIDERS.find((p) => p.id === "ollama")?.models ?? [],
		);
	});
});

describe("resolveAIProvidersForUI", () => {
	it("appends customModels only when not already in the remote list", async () => {
		writeCredentials({
			ai: { openai: { token: "sk-test" } },
		});
		writeConfig(
			emptyConfig({
				ai: {
					customModels: {
						openai: ["gpt-5-mini", "my-fine-tune"],
					},
				},
			}),
		);

		originalFetch = globalThis.fetch;
		globalThis.fetch = mock().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [
						{ id: "gpt-5-mini", owned_by: "openai" },
						{ id: "o4-mini", owned_by: "openai" },
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		) as typeof globalThis.fetch;

		const providers = await resolveAIProvidersForUI();
		const openai = providers.find((p) => p.id === "openai");
		expect(openai?.models).toEqual(["gpt-5-mini", "o4-mini", "my-fine-tune"]);
		// gpt-5-mini from customModels must not duplicate the remote entry
		expect(openai?.models.filter((m) => m === "gpt-5-mini")).toHaveLength(1);
	});
});
