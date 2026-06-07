import type { AIProviderPlanUsage, PlanUsageAdapter } from "../types";

const OPENAI_UNSUPPORTED_REASON =
	"OpenAI does not expose plan balance via API keys. Check usage in the OpenAI dashboard.";

export const openAiPlanUsageAdapter: PlanUsageAdapter = {
	providerId: "openai",

	async fetchPlanUsage(): Promise<AIProviderPlanUsage> {
		return {
			providerId: "openai",
			supported: false,
			unavailableReason: OPENAI_UNSUPPORTED_REASON,
			fetchedAt: new Date().toISOString(),
		};
	},
};
