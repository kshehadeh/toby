import type { CoreMessage } from "../../chat";
import {
	GATEWAY_MESSAGE_CACHE_UPSTREAMS,
	asProviderOptionsRecord,
	gatewayAutoCachingPatch,
	mergeProviderOptions,
	openAiPromptCacheKeyPatch,
	parseGatewayUpstream,
} from "../shared";
import type { CacheAdapter, TokenUsageReport } from "../types";
import { defaultTokenUsageReport } from "../usage";
import { cacheTokensFromRawUsage } from "../usage-raw";

function withAnthropicSystemCacheControl(
	messages: readonly CoreMessage[],
): CoreMessage[] {
	let marked = false;
	return messages.map((message) => {
		if (marked || message.role !== "system") {
			return message;
		}
		marked = true;
		const existing = asProviderOptionsRecord(message.providerOptions);
		const existingAnthropic = asProviderOptionsRecord(existing?.anthropic);
		return {
			...message,
			providerOptions: mergeProviderOptions(existing ?? {}, {
				anthropic: {
					...(existingAnthropic ?? {}),
					cacheControl: { type: "ephemeral" },
				},
			}),
		} as CoreMessage;
	});
}

export const vercelGatewayCacheAdapter: CacheAdapter = {
	providerId: "vercel",

	applyProviderOptions(params) {
		const { persona } = params;
		const upstream = parseGatewayUpstream(persona.ai.model);
		const existing = asProviderOptionsRecord(params.existingProviderOptions);
		const existingGateway = asProviderOptionsRecord(existing?.gateway);

		let patch = gatewayAutoCachingPatch(existingGateway);

		if (upstream === "openai") {
			patch = mergeProviderOptions(patch, openAiPromptCacheKeyPatch(params));
		}

		return mergeProviderOptions(existing ?? {}, patch);
	},

	applyMessageCacheHints(params) {
		const upstream = parseGatewayUpstream(params.persona.ai.model);
		if (!upstream || !GATEWAY_MESSAGE_CACHE_UPSTREAMS.has(upstream)) {
			return [...params.messages];
		}
		return withAnthropicSystemCacheControl(params.messages);
	},

	normalizeUsageReport(params): TokenUsageReport {
		const base = defaultTokenUsageReport(params.usage, params);
		const fromRaw = cacheTokensFromRawUsage(params.usage.raw);
		return {
			...base,
			cacheReadTokens: base.cacheReadTokens ?? fromRaw.cacheReadTokens,
			cacheWriteTokens: base.cacheWriteTokens ?? fromRaw.cacheWriteTokens,
		};
	},
};
