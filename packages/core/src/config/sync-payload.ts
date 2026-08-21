import { createHash } from "node:crypto";
import { type CredentialsFile, readConfigRaw, readCredentials } from "./index";

/** Config keys that stay machine-local and are never written to the vault. */
export const SYNC_CONFIG_DENYLIST = ["activeProject", "web"] as const;

export type SyncDeniedConfigKey = (typeof SYNC_CONFIG_DENYLIST)[number];

export interface SyncPayload {
	version: 1;
	config: Record<string, unknown>;
	credentials: CredentialsFile | Record<string, unknown>;
}

export function stripDeniedConfigKeys(
	config: Record<string, unknown>,
): Record<string, unknown> {
	const next = { ...config };
	for (const key of SYNC_CONFIG_DENYLIST) {
		delete next[key];
	}
	return next;
}

/** Keep local denylisted keys when applying a remote config object. */
export function mergeDeniedConfigKeys(
	incoming: Record<string, unknown>,
	local: Record<string, unknown>,
): Record<string, unknown> {
	const merged = stripDeniedConfigKeys(incoming);
	for (const key of SYNC_CONFIG_DENYLIST) {
		if (key in local) {
			merged[key] = local[key];
		}
	}
	return merged;
}

export function buildSyncPayload(): SyncPayload {
	return {
		version: 1,
		config: stripDeniedConfigKeys(readConfigRaw()),
		credentials: readCredentials(),
	};
}

export function stableStringify(value: unknown): string {
	return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortValue);
	}
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(obj).sort()) {
			sorted[key] = sortValue(obj[key]);
		}
		return sorted;
	}
	return value;
}

export function hashPayload(payload: SyncPayload): string {
	return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function isSyncPayload(value: unknown): value is SyncPayload {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.version === 1 &&
		typeof record.config === "object" &&
		record.config !== null &&
		!Array.isArray(record.config) &&
		typeof record.credentials === "object" &&
		record.credentials !== null &&
		!Array.isArray(record.credentials)
	);
}

export function parseSyncPayload(value: unknown): SyncPayload {
	if (!isSyncPayload(value)) {
		throw new Error("Not a valid Toby config sync payload.");
	}
	return value;
}

export function localConfigLooksEmpty(): boolean {
	const config = readConfigRaw();
	const creds = readCredentials();
	const integrations = config.integrations;
	const hasIntegrations =
		typeof integrations === "object" &&
		integrations !== null &&
		!Array.isArray(integrations) &&
		Object.keys(integrations).length > 0;
	const personas = config.personas;
	const hasPersonas = Array.isArray(personas) && personas.length > 0;
	const hasCreds = Object.keys(creds).length > 0;
	return !hasIntegrations && !hasPersonas && !hasCreds;
}
