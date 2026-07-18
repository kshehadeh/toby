import { vercelProviderSetupAdapter } from "./adapters/vercel";
import type { ProviderSetupAdapter } from "./types";

const ADAPTERS: readonly ProviderSetupAdapter[] = [vercelProviderSetupAdapter];

const byId = new Map(ADAPTERS.map((a) => [a.providerId, a]));

export function getProviderSetupAdapter(
	providerId: string,
): ProviderSetupAdapter | undefined {
	return byId.get(providerId);
}

export function listProviderSetupAdapters(): readonly ProviderSetupAdapter[] {
	return ADAPTERS;
}

export function hasProviderSetupAdapter(providerId: string): boolean {
	return byId.has(providerId);
}
