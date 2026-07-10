import type { LanguageModelUsage } from "ai";
import { fetchVercelContextWindows } from "./model-list/vercel-catalog";

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
