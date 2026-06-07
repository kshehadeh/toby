import { openAiPlanUsageAdapter } from "./adapters/openai";
import { vercelGatewayPlanUsageAdapter } from "./adapters/vercel-gateway";
import type { PlanUsageAdapter } from "./types";

const ADAPTERS: readonly PlanUsageAdapter[] = [
	openAiPlanUsageAdapter,
	vercelGatewayPlanUsageAdapter,
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
