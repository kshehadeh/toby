import crypto from "node:crypto";
import type { Persona } from "../../config/index";
import type { ChatCacheContext } from "./types";

export const DEFAULT_CHAT_PROMPT_SCHEMA_VERSION = "2";

/** Upstreams where we also add message-level Anthropic-style cache markers. */
export const GATEWAY_MESSAGE_CACHE_UPSTREAMS = new Set([
	"anthropic",
	"minimax",
]);

export function gatewayAutoCachingPatch(
	existingGateway?: Record<string, unknown>,
): Record<string, unknown> {
	return mergeProviderOptions(
		{ gateway: existingGateway ?? {} },
		{
			gateway: {
				...(existingGateway ?? {}),
				caching: "auto",
			},
		},
	);
}

export function sha256Base64Url(input: string): string {
	return crypto
		.createHash("sha256")
		.update(input)
		.digest("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

export function parseGatewayUpstream(model: string): string | null {
	const slash = model.indexOf("/");
	if (slash <= 0) {
		return null;
	}
	return model.slice(0, slash).toLowerCase();
}

export function buildStablePromptCacheKey(params: {
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

export function asProviderOptionsRecord(
	raw: unknown,
): Record<string, unknown> | undefined {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		return raw as Record<string, unknown>;
	}
	return undefined;
}

/** Shallow merge at top level; one-level deep merge per provider namespace key. */
export function mergeProviderOptions(
	existing: Record<string, unknown> | undefined,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...existing };
	for (const [key, value] of Object.entries(patch)) {
		const prev = result[key];
		if (
			value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			prev &&
			typeof prev === "object" &&
			!Array.isArray(prev)
		) {
			result[key] = {
				...(prev as Record<string, unknown>),
				...(value as Record<string, unknown>),
			};
		} else {
			result[key] = value;
		}
	}
	return result;
}

export function openAiPromptCacheKeyPatch(
	params: ChatCacheContext,
): Record<string, unknown> {
	const promptCacheKey = buildStablePromptCacheKey(params);
	return {
		openai: {
			promptCacheKey,
		},
	};
}
