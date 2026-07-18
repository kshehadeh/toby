/**
 * OpenRouter guided setup adapter.
 */

import {
	type CredentialsFile,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "../../../config/index";
import { DEFAULT_CHAT_PERSONA } from "../../../personas/index";
import type {
	ProviderSetupAdapter,
	ProviderSetupGuide,
	ProviderSetupRequest,
	ProviderSetupResult,
} from "../types";

/** Matches OpenRouter everyday default / auxiliary model in Toby. */
export const OPENROUTER_DEFAULT_SETUP_MODEL = "openai/gpt-5.6-luna";

export const OPENROUTER_SIGNUP_URL = "https://openrouter.ai/";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";

const KEY_INFO_URL = "https://openrouter.ai/api/v1/key";
const VALIDATE_TIMEOUT_MS = 12_000;

type KeyValidation =
	| {
			ok: true;
			remaining?: number;
			totalSpent?: number;
			label?: string;
	  }
	| { ok: false; error: string; status?: number };

function parseOptionalNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

/**
 * Probe OpenRouter `GET /api/v1/key` with the candidate key.
 * Exported for unit tests (injectable fetch).
 */
export async function validateOpenRouterApiKey(
	apiKey: string,
	options?: { fetchImpl?: typeof fetch },
): Promise<KeyValidation> {
	const token = apiKey.trim();
	if (!token) {
		return { ok: false, error: "API key is required." };
	}

	const fetchImpl = options?.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);

	try {
		const response = await fetchImpl(KEY_INFO_URL, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			signal: controller.signal,
		});

		if (response.status === 401 || response.status === 403) {
			return {
				ok: false,
				error:
					"That API key was rejected. Create a new key at openrouter.ai/keys and paste it again.",
				status: response.status,
			};
		}

		if (!response.ok) {
			let detail = response.statusText;
			try {
				const body = (await response.json()) as {
					error?: { message?: string };
				};
				if (body.error?.message) {
					detail = body.error.message;
				}
			} catch {
				// ignore parse errors
			}
			return {
				ok: false,
				error: `OpenRouter returned ${response.status}: ${detail}`,
				status: response.status,
			};
		}

		const body = (await response.json()) as {
			data?: {
				limit_remaining?: unknown;
				usage?: unknown;
				label?: unknown;
			};
		};
		const data = body.data;

		return {
			ok: true,
			remaining: parseOptionalNumber(data?.limit_remaining),
			totalSpent: parseOptionalNumber(data?.usage),
			...(typeof data?.label === "string" ? { label: data.label } : {}),
		};
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return {
				ok: false,
				error:
					"Timed out reaching OpenRouter. Check your network and try again.",
			};
		}
		const msg = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			error: `Failed to reach OpenRouter: ${msg}`,
		};
	} finally {
		clearTimeout(timer);
	}
}

function applyOpenRouterCredentialsAndPersona(params: {
	apiKey: string;
	model: string;
}): { model: string; personaName: string } {
	const existing = readCredentials();
	const next: CredentialsFile = {
		...existing,
		ai: {
			...existing.ai,
			openrouter: { apiKey: params.apiKey },
		},
	};
	writeCredentials(next);

	const personaName = DEFAULT_CHAT_PERSONA.name;
	const cfg = readConfig();
	let persona = cfg.personas.find((p) => p.name === personaName);
	if (!persona) {
		persona = {
			...DEFAULT_CHAT_PERSONA,
			ai: { ...DEFAULT_CHAT_PERSONA.ai },
		};
		cfg.personas.unshift(persona);
	}
	persona.ai.provider = "openrouter";
	persona.ai.model = params.model;
	writeConfig(cfg);

	return { model: params.model, personaName };
}

function buildGuide(): ProviderSetupGuide {
	return {
		providerId: "openrouter",
		displayName: "OpenRouter",
		description:
			"One OpenRouter API key unlocks hundreds of models from OpenAI, Anthropic, Google, Meta, and more through a single catalog.",
		defaultModel: OPENROUTER_DEFAULT_SETUP_MODEL,
		fields: [
			{
				key: "apiKey",
				label: "API Key",
				secret: true,
				placeholder: "sk-or-…",
				required: true,
			},
		],
		steps: [
			{
				id: "account",
				title: "Create or sign in to OpenRouter",
				description:
					"Sign up with email or an OAuth provider. You can add credits after creating a key.",
				url: OPENROUTER_SIGNUP_URL,
				urlLabel: "Open OpenRouter",
			},
			{
				id: "create-key",
				title: "Create an API key",
				description:
					'Open Keys, create a key (name it "Toby"), and copy it immediately.',
				url: OPENROUTER_KEYS_URL,
				urlLabel: "Open OpenRouter Keys",
			},
			{
				id: "paste",
				title: "Paste the key into Toby",
				description:
					"Toby validates the key with OpenRouter, saves it securely, and sets your default persona to OpenRouter.",
			},
		],
		meta: {
			signupUrl: OPENROUTER_SIGNUP_URL,
			apiKeysUrl: OPENROUTER_KEYS_URL,
			recommended: false,
		},
	};
}

export const openRouterProviderSetupAdapter: ProviderSetupAdapter = {
	providerId: "openrouter",

	getGuide() {
		return buildGuide();
	},

	async setup(request: ProviderSetupRequest): Promise<ProviderSetupResult> {
		const apiKey = request.fields.apiKey?.trim() ?? "";
		if (!apiKey) {
			return { ok: false, error: "API key is required.", status: 400 };
		}

		const validation = await validateOpenRouterApiKey(apiKey);
		if (!validation.ok) {
			return {
				ok: false,
				error: validation.error,
				status: validation.status === 401 ? 401 : 400,
			};
		}

		const model = (
			request.model?.trim() || OPENROUTER_DEFAULT_SETUP_MODEL
		).trim();
		const applied = applyOpenRouterCredentialsAndPersona({ apiKey, model });

		const details: Record<string, unknown> = {};
		if (validation.remaining !== undefined) {
			details.remaining = validation.remaining;
		}
		if (validation.totalSpent !== undefined) {
			details.totalSpent = validation.totalSpent;
		}
		if (validation.label) {
			details.label = validation.label;
		}

		return {
			ok: true,
			providerId: "openrouter",
			model: applied.model,
			personaName: applied.personaName,
			...(Object.keys(details).length > 0 ? { details } : {}),
		};
	},
};
