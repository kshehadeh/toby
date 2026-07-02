import type { LanguageModelUsage } from "ai";

export type AIContextWindowInfo =
	| {
			readonly supported: true;
			readonly contextWindowTokens: number;
			readonly fillPercentage?: number;
	  }
	| {
			readonly supported: false;
			readonly unavailableReason: string;
	  };

type VercelGatewayModel = {
	readonly id?: unknown;
	readonly context_window?: unknown;
};

type VercelGatewayModelsResponse = {
	readonly data?: unknown;
};

const VERCEL_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

let vercelContextWindowCache:
	| {
			readonly expiresAt: number;
			readonly windows: ReadonlyMap<string, number>;
	  }
	| undefined;

export function computeContextFillPercentage(
	inputTokens: number | undefined,
	contextWindowTokens: number,
): number | undefined {
	if (
		typeof inputTokens !== "number" ||
		inputTokens <= 0 ||
		!Number.isFinite(inputTokens) ||
		contextWindowTokens <= 0
	) {
		return undefined;
	}
	return Math.max(
		0,
		Math.min(100, Math.round((inputTokens / contextWindowTokens) * 100)),
	);
}

function positiveFiniteNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value;
}

function firstPositiveFiniteNumber(
	...values: readonly unknown[]
): number | undefined {
	for (const value of values) {
		const num = positiveFiniteNumber(value);
		if (num !== undefined) {
			return num;
		}
	}
	return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function extractContextInputTokens(
	usage: LanguageModelUsage | undefined,
): number | undefined {
	const usageRecord = asRecord(usage);
	if (!usageRecord) {
		return undefined;
	}

	const details = asRecord(usageRecord.inputTokenDetails);
	const fromSdk = firstPositiveFiniteNumber(
		usageRecord.inputTokens,
		usageRecord.promptTokens,
		usageRecord.input_tokens,
		usageRecord.prompt_tokens,
	);
	if (fromSdk !== undefined) {
		return fromSdk;
	}

	const totalTokens = positiveFiniteNumber(usageRecord.totalTokens);
	const outputTokens = positiveFiniteNumber(usageRecord.outputTokens);
	if (
		totalTokens !== undefined &&
		outputTokens !== undefined &&
		totalTokens > outputTokens
	) {
		return totalTokens - outputTokens;
	}

	const fromDetails =
		positiveFiniteNumber(details?.noCacheTokens) !== undefined ||
		positiveFiniteNumber(details?.cacheReadTokens) !== undefined ||
		positiveFiniteNumber(details?.cacheWriteTokens) !== undefined
			? (positiveFiniteNumber(details?.noCacheTokens) ?? 0) +
				(positiveFiniteNumber(details?.cacheReadTokens) ?? 0) +
				(positiveFiniteNumber(details?.cacheWriteTokens) ?? 0)
			: undefined;
	if (fromDetails !== undefined && fromDetails > 0) {
		return fromDetails;
	}

	const raw = asRecord(usageRecord.raw);
	const rawUsage = asRecord(raw?.usage) ?? raw;
	const rawInputDetails = asRecord(rawUsage?.input_token_details);
	const fromRaw = firstPositiveFiniteNumber(
		rawUsage?.inputTokens,
		rawUsage?.promptTokens,
		rawUsage?.input_tokens,
		rawUsage?.prompt_tokens,
		rawUsage?.total_input_tokens,
		rawUsage?.totalInputTokens,
		rawInputDetails?.total_tokens,
		rawInputDetails?.totalTokens,
	);
	if (fromRaw !== undefined) {
		return fromRaw;
	}

	const rawTotalTokens = firstPositiveFiniteNumber(
		rawUsage?.totalTokens,
		rawUsage?.total_tokens,
	);
	const rawOutputTokens = firstPositiveFiniteNumber(
		rawUsage?.outputTokens,
		rawUsage?.completionTokens,
		rawUsage?.output_tokens,
		rawUsage?.completion_tokens,
	);
	if (
		rawTotalTokens !== undefined &&
		rawOutputTokens !== undefined &&
		rawTotalTokens > rawOutputTokens
	) {
		return rawTotalTokens - rawOutputTokens;
	}

	return undefined;
}

async function fetchVercelContextWindows(): Promise<
	ReadonlyMap<string, number>
> {
	const now = Date.now();
	if (vercelContextWindowCache && vercelContextWindowCache.expiresAt > now) {
		return vercelContextWindowCache.windows;
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetch(VERCEL_MODELS_URL, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`AI Gateway models API returned HTTP ${response.status}`);
		}
	} finally {
		clearTimeout(timeout);
	}
	const body = (await response.json()) as VercelGatewayModelsResponse;
	const models = Array.isArray(body.data) ? body.data : [];
	const windows = new Map<string, number>();
	for (const item of models) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const model = item as VercelGatewayModel;
		if (typeof model.id !== "string") {
			continue;
		}
		if (
			typeof model.context_window === "number" &&
			Number.isFinite(model.context_window) &&
			model.context_window > 0
		) {
			windows.set(model.id.toLowerCase(), model.context_window);
		}
	}
	vercelContextWindowCache = {
		expiresAt: now + CACHE_TTL_MS,
		windows,
	};
	return windows;
}

export async function resolveContextWindowInfo(params: {
	readonly providerId: string;
	readonly model: string;
	readonly usage?: LanguageModelUsage;
}): Promise<AIContextWindowInfo | undefined> {
	if (params.providerId !== "vercel") {
		return {
			supported: false,
			unavailableReason: "Provider doesn't support context window information.",
		};
	}

	const model = params.model.trim().toLowerCase();
	if (!model) {
		return undefined;
	}

	try {
		const windows = await fetchVercelContextWindows();
		const contextWindowTokens = windows.get(model);
		if (!contextWindowTokens) {
			return undefined;
		}
		const fillPercentage = computeContextFillPercentage(
			extractContextInputTokens(params.usage),
			contextWindowTokens,
		);
		return {
			supported: true,
			contextWindowTokens,
			...(fillPercentage !== undefined ? { fillPercentage } : {}),
		};
	} catch {
		return undefined;
	}
}
