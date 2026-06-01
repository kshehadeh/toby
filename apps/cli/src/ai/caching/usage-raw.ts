/** Best-effort cache token extraction from provider `usage.raw` payloads. */
export function cacheTokensFromRawUsage(raw: unknown): {
	readonly cacheReadTokens?: number;
	readonly cacheWriteTokens?: number;
} {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return {};
	}

	const record = raw as Record<string, unknown>;

	const openAiDetails = record.prompt_tokens_details;
	if (openAiDetails && typeof openAiDetails === "object") {
		const cached = (openAiDetails as Record<string, unknown>).cached_tokens;
		if (typeof cached === "number") {
			return { cacheReadTokens: cached };
		}
	}

	const usage =
		record.usage && typeof record.usage === "object"
			? (record.usage as Record<string, unknown>)
			: record;

	const inputDetails =
		usage.input_token_details && typeof usage.input_token_details === "object"
			? (usage.input_token_details as Record<string, unknown>)
			: undefined;

	const read =
		usage.cache_read_input_tokens ??
		usage.cacheReadInputTokens ??
		inputDetails?.cached_tokens;

	const write =
		usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens;

	const result: {
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	} = {};
	if (typeof read === "number") {
		result.cacheReadTokens = read;
	}
	if (typeof write === "number") {
		result.cacheWriteTokens = write;
	}
	return result;
}
