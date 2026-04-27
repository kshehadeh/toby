import crypto from "node:crypto";
import type { Persona } from "../config/index";
import type { ChatWithToolsOptions } from "./chat";

const DEFAULT_CHAT_PROMPT_SCHEMA_VERSION = "1";

function sha256Base64Url(input: string): string {
	return crypto
		.createHash("sha256")
		.update(input)
		.digest("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function buildOpenAIPromptCacheKey(params: {
	readonly persona: Persona;
	readonly moduleNames: readonly string[];
	readonly promptSchemaVersion?: string;
}): string {
	const modules = [...params.moduleNames].sort((a, b) => a.localeCompare(b));
	const personaSig = sha256Base64Url(
		`${params.persona.name}\n${params.persona.promptMode}\n${params.persona.instructions}`,
	).slice(0, 16);

	const schema =
		params.promptSchemaVersion ?? DEFAULT_CHAT_PROMPT_SCHEMA_VERSION;

	// OpenAI enforces a max length of 64 chars for prompt_cache_key.
	// Keep this stable and short; intentionally excludes user/session content.
	const signature = JSON.stringify({
		schema,
		model: params.persona.ai.model,
		persona: params.persona.name,
		psig: personaSig,
		mods: modules,
	});
	const digest = sha256Base64Url(signature).slice(0, 32);
	return `toby-chat-v${schema}-${digest}`;
}

function mergeProviderOptions(
	existing: Record<string, unknown> | undefined,
	next: Record<string, unknown>,
): Record<string, unknown> {
	return { ...(existing ?? {}), ...next };
}

export function applyChatPromptCaching(
	chatWithToolsOptions: ChatWithToolsOptions | undefined,
	params: {
		readonly persona: Persona;
		readonly moduleNames: readonly string[];
		readonly promptSchemaVersion?: string;
	},
): ChatWithToolsOptions | undefined {
	if (params.persona.ai.provider !== "openai") {
		return chatWithToolsOptions;
	}

	const promptCacheKey = buildOpenAIPromptCacheKey({
		persona: params.persona,
		moduleNames: params.moduleNames,
		promptSchemaVersion: params.promptSchemaVersion,
	});

	const rawExisting = chatWithToolsOptions?.providerOptions;
	const existing =
		rawExisting &&
		typeof rawExisting === "object" &&
		!Array.isArray(rawExisting)
			? (rawExisting as Record<string, unknown>)
			: undefined;

	// This is OpenAI-only today. If/when we add Anthropic, we can also merge
	// message-level cacheControl hints (via message.providerOptions) using the
	// same central helper module.
	return {
		...chatWithToolsOptions,
		providerOptions: mergeProviderOptions(existing, {
			openai: {
				...(typeof existing?.openai === "object" && existing.openai
					? (existing.openai as Record<string, unknown>)
					: null),
				promptCacheKey,
			},
		}),
	};
}
