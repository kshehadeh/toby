import fs from "node:fs";
import type { PluginToolsListResponse } from "./protocol";

type CachedToolDefinitions = {
	readonly binaryPath: string;
	readonly mtimeMs: number;
	readonly version: string;
	readonly protocolVersion: string;
	readonly tools: NonNullable<PluginToolsListResponse["tools"]>;
};

const cache = new Map<string, CachedToolDefinitions>();

function statBinary(binaryPath: string): { mtimeMs: number } | null {
	try {
		const stat = fs.statSync(binaryPath);
		return { mtimeMs: stat.mtimeMs };
	} catch {
		return null;
	}
}

function cacheKey(binaryPath: string): string {
	return binaryPath;
}

/**
 * Returns cached plugin tool definitions when the binary path, mtime, version,
 * and protocol version all match. Avoids spawning `tools list` on every turn
 * for unchanged plugins.
 */
export function getCachedPluginToolDefinitions(params: {
	readonly binaryPath: string;
	readonly version: string;
	readonly protocolVersion: string;
}): NonNullable<PluginToolsListResponse["tools"]> | null {
	const key = cacheKey(params.binaryPath);
	const entry = cache.get(key);
	if (!entry) return null;
	const stat = statBinary(params.binaryPath);
	if (!stat || stat.mtimeMs !== entry.mtimeMs) {
		cache.delete(key);
		return null;
	}
	if (
		entry.version !== params.version ||
		entry.protocolVersion !== params.protocolVersion
	) {
		cache.delete(key);
		return null;
	}
	return entry.tools;
}

export function setCachedPluginToolDefinitions(params: {
	readonly binaryPath: string;
	readonly version: string;
	readonly protocolVersion: string;
	readonly tools: NonNullable<PluginToolsListResponse["tools"]>;
}): void {
	const stat = statBinary(params.binaryPath);
	if (!stat) return;
	cache.set(cacheKey(params.binaryPath), {
		binaryPath: params.binaryPath,
		mtimeMs: stat.mtimeMs,
		version: params.version,
		protocolVersion: params.protocolVersion,
		tools: params.tools,
	});
}

export function clearPluginToolDefinitionCache(): void {
	cache.clear();
}
