/**
 * Vercel AI Gateway guided setup adapter.
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

export const VERCEL_AI_GATEWAY_DEFAULT_MODEL = "openai/gpt-5-mini";
export const VERCEL_SIGNUP_URL = "https://vercel.com/signup";
export const VERCEL_AI_GATEWAY_API_KEYS_URL =
	"https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keys";

const CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";
const VALIDATE_TIMEOUT_MS = 12_000;

function parseUsdAmount(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

type KeyValidation =
	| { ok: true; remaining?: number; totalSpent?: number }
	| { ok: false; error: string; status?: number };

/** Exported for unit tests (injectable fetch). */
export async function validateVercelAIGatewayApiKey(
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
		const response = await fetchImpl(CREDITS_URL, {
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
					"That API key was rejected. Create a new AI Gateway key in the Vercel dashboard and paste it again.",
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
				error: `Vercel AI Gateway returned ${response.status}: ${detail}`,
				status: response.status,
			};
		}

		const body = (await response.json()) as {
			balance?: unknown;
			total_used?: unknown;
		};

		return {
			ok: true,
			remaining: parseUsdAmount(body.balance),
			totalSpent: parseUsdAmount(body.total_used),
		};
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return {
				ok: false,
				error:
					"Timed out reaching Vercel AI Gateway. Check your network and try again.",
			};
		}
		const msg = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			error: `Failed to reach Vercel AI Gateway: ${msg}`,
		};
	} finally {
		clearTimeout(timer);
	}
}

function applyVercelCredentialsAndPersona(params: {
	apiKey: string;
	model: string;
}): { model: string; personaName: string } {
	const existing = readCredentials();
	const next: CredentialsFile = {
		...existing,
		ai: {
			...existing.ai,
			vercel: { apiKey: params.apiKey },
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
	persona.ai.provider = "vercel";
	persona.ai.model = params.model;
	writeConfig(cfg);

	return { model: params.model, personaName };
}

function buildGuide(): ProviderSetupGuide {
	return {
		providerId: "vercel",
		displayName: "Vercel AI Gateway",
		description:
			"One free Vercel account and one API key unlock chat across OpenAI, Anthropic, Google, and more — plus Toby web search and transcription catalogs.",
		defaultModel: VERCEL_AI_GATEWAY_DEFAULT_MODEL,
		fields: [
			{
				key: "apiKey",
				label: "API Key",
				secret: true,
				placeholder: "vck_…",
				required: true,
			},
		],
		steps: [
			{
				id: "account",
				title: "Create or sign in to Vercel",
				description:
					"A free Vercel account is enough to start. New teams get free AI Gateway credits for a subset of models.",
				url: VERCEL_SIGNUP_URL,
				urlLabel: "Open Vercel signup",
			},
			{
				id: "create-key",
				title: "Create an AI Gateway API key",
				description:
					'Open AI Gateway → API Keys, click Create key, name it "Toby", and copy the key immediately (it is only shown once).',
				url: VERCEL_AI_GATEWAY_API_KEYS_URL,
				urlLabel: "Open AI Gateway API Keys",
			},
			{
				id: "paste",
				title: "Paste the key into Toby",
				description:
					"Toby validates the key with Vercel, saves it securely, and sets your default persona to Vercel AI Gateway.",
			},
		],
		meta: {
			signupUrl: VERCEL_SIGNUP_URL,
			apiKeysUrl: VERCEL_AI_GATEWAY_API_KEYS_URL,
			recommended: true,
		},
	};
}

export const vercelProviderSetupAdapter: ProviderSetupAdapter = {
	providerId: "vercel",

	getGuide() {
		return buildGuide();
	},

	async setup(request: ProviderSetupRequest): Promise<ProviderSetupResult> {
		const apiKey = request.fields.apiKey?.trim() ?? "";
		if (!apiKey) {
			return { ok: false, error: "API key is required.", status: 400 };
		}

		const validation = await validateVercelAIGatewayApiKey(apiKey);
		if (!validation.ok) {
			return {
				ok: false,
				error: validation.error,
				status: validation.status === 401 ? 401 : 400,
			};
		}

		const model = (
			request.model?.trim() || VERCEL_AI_GATEWAY_DEFAULT_MODEL
		).trim();
		const applied = applyVercelCredentialsAndPersona({ apiKey, model });

		const details: Record<string, unknown> = {};
		if (validation.remaining !== undefined) {
			details.remaining = validation.remaining;
		}
		if (validation.totalSpent !== undefined) {
			details.totalSpent = validation.totalSpent;
		}

		return {
			ok: true,
			providerId: "vercel",
			model: applied.model,
			personaName: applied.personaName,
			...(Object.keys(details).length > 0 ? { details } : {}),
		};
	},
};
