import { openAiPlanUsageAdapter } from "./adapters/openai";
import { openRouterPlanUsageAdapter } from "./adapters/openrouter";
import { vercelGatewayPlanUsageAdapter } from "./adapters/vercel-gateway";
import type { PlanUsageAdapter } from "./types";

const ADAPTERS: readonly PlanUsageAdapter[] = [
	openAiPlanUsageAdapter,
	vercelGatewayPlanUsageAdapter,
	openRouterPlanUsageAdapter,
];

const byId = new Map(ADAPTERS.map((a) => [a.providerId, a]));

export function getPlanUsageAdapter(
	providerId: string,
): PlanUsageAdapter | undefined {
	return byId.get(providerId);
}

export function listPlanUsageAdapters(): readonly PlanUsageAdapter[] {
	return ADAPTERS;
}
