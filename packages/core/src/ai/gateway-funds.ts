import { getAIProviderDisplayName } from "./providers";

export const GATEWAY_FUNDS_EXHAUSTED_CODE = "gateway_funds_exhausted" as const;

export type GatewayProviderId = "vercel" | "openrouter";

/** Wire payload for HTTP error bodies and SSE `event: error`. */
export type GatewayFundsErrorBody = {
	readonly error: string;
	readonly code: typeof GATEWAY_FUNDS_EXHAUSTED_CODE;
	readonly providerId: GatewayProviderId;
	readonly activity: string;
};

const FUNDS_MESSAGE =
	/credit balance|insufficient credits|insufficient funds|out of credits|payment required/i;

/**
 * A gateway account cannot pay for the request. `message` is the short
 * sentence shown on the failed surface; the banner adds the activity.
 */
export class GatewayFundsError extends Error {
	readonly code = GATEWAY_FUNDS_EXHAUSTED_CODE;
	readonly providerId: GatewayProviderId;
	readonly providerName: string;
	readonly activity: string;

	constructor(providerId: GatewayProviderId, activity: string) {
		const providerName = getAIProviderDisplayName(providerId);
		super(`${providerName} is out of funds.`);
		this.name = "GatewayFundsError";
		this.providerId = providerId;
		this.providerName = providerName;
		this.activity = activity;
	}

	toBody(): GatewayFundsErrorBody {
		return {
			error: this.message,
			code: this.code,
			providerId: this.providerId,
			activity: this.activity,
		};
	}
}

export function toolFundsActivity(toolName: string): string {
	if (toolName === "webSearch") return "search the web";
	return "run a tool";
}

/**
 * Recognize a Vercel AI Gateway or OpenRouter out-of-funds failure.
 * Direct providers (for example OpenAI) stay on their existing error path.
 * An already-classified {@link GatewayFundsError} keeps its original activity.
 */
export function gatewayFundsErrorBody(
	error: unknown,
	activity: string,
	providerHint?: string,
): GatewayFundsErrorBody | null {
	if (error instanceof GatewayFundsError) {
		return error.toBody();
	}

	const nodes = collectErrors(error);
	const texts = nodes.map(textOf).filter((text) => text.length > 0);
	const status = nodes
		.map(statusOf)
		.find((value): value is number => value !== undefined);
	const url = nodes.map(urlOf).find((value): value is string => Boolean(value));
	const looksLikeFunds =
		status === 402 || texts.some((text) => FUNDS_MESSAGE.test(text));
	if (!looksLikeFunds) return null;

	const fromUrl = providerFromUrl(url);
	const fromHint = providerFromHint(providerHint);
	if (providerHint && fromHint === undefined && fromUrl === undefined) {
		return null;
	}
	const providerId = fromUrl ?? fromHint;
	if (!providerId) return null;
	return new GatewayFundsError(providerId, activity).toBody();
}

/** Funds payload already attached to a tool result or error object. */
export function readGatewayFundsPayload(
	value: unknown,
): GatewayFundsErrorBody | null {
	if (!value || typeof value !== "object") return null;
	const record = value as {
		code?: unknown;
		providerId?: unknown;
		activity?: unknown;
		error?: unknown;
	};
	if (record.code !== GATEWAY_FUNDS_EXHAUSTED_CODE) return null;
	if (record.providerId !== "vercel" && record.providerId !== "openrouter") {
		return null;
	}
	if (typeof record.activity !== "string" || typeof record.error !== "string") {
		return null;
	}
	return {
		error: record.error,
		code: GATEWAY_FUNDS_EXHAUSTED_CODE,
		providerId: record.providerId,
		activity: record.activity,
	};
}

/**
 * Funds failure carried by a tool result: either the structured payload or an
 * `{ error }` string that matches a gateway credit failure.
 */
export function resolveToolFundsError(
	value: unknown,
	toolName: string,
	providerHint?: string,
): GatewayFundsErrorBody | null {
	const existing = readGatewayFundsPayload(value);
	if (existing) return existing;
	if (!value || typeof value !== "object" || !("error" in value)) return null;
	const message = (value as { error?: unknown }).error;
	if (typeof message !== "string" || !message.trim()) return null;
	return gatewayFundsErrorBody(
		new Error(message),
		toolFundsActivity(toolName),
		providerHint,
	);
}

function providerFromHint(
	id: string | undefined,
): GatewayProviderId | undefined {
	if (id === "vercel" || id === "openrouter") return id;
	return undefined;
}

function providerFromUrl(
	url: string | undefined,
): GatewayProviderId | undefined {
	if (!url) return undefined;
	const lower = url.toLowerCase();
	if (lower.includes("ai-gateway.vercel.sh")) return "vercel";
	if (lower.includes("openrouter.ai")) return "openrouter";
	return undefined;
}

function collectErrors(error: unknown, seen = new Set<object>()): unknown[] {
	if (typeof error === "string") return [error];
	if (error == null || typeof error !== "object") return [];
	if (seen.has(error)) return [];
	seen.add(error);
	const list: unknown[] = [error];
	const cause = (error as { cause?: unknown }).cause;
	if (cause !== undefined) list.push(...collectErrors(cause, seen));
	return list;
}

function statusOf(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const record = error as { statusCode?: unknown; status?: unknown };
	if (typeof record.statusCode === "number") return record.statusCode;
	if (typeof record.status === "number") return record.status;
	return undefined;
}

function urlOf(error: unknown): string | undefined {
	if (!error || typeof error !== "object") return undefined;
	const url = (error as { url?: unknown }).url;
	return typeof url === "string" ? url : undefined;
}

function textOf(error: unknown): string {
	if (typeof error === "string") return error;
	if (!error || typeof error !== "object") return "";
	const parts: string[] = [];
	if (error instanceof Error && error.message) parts.push(error.message);
	const record = error as { message?: unknown; responseBody?: unknown };
	if (typeof record.message === "string") parts.push(record.message);
	if (typeof record.responseBody === "string") parts.push(record.responseBody);
	return parts.join("\n");
}
