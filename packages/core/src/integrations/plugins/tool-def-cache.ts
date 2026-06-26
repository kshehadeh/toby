import fs from "node:fs";
import type {
	PluginInvocationTarget,
	PluginToolsListResponse,
} from "./protocol";

type CachedToolDefinitions = {
	readonly cacheKey: string;
	readonly mtimeMs: number;
	readonly version: string;
	readonly protocolVersion: string;
	readonly tools: NonNullable<PluginToolsListResponse["tools"]>;
};

const cache = new Map<string, CachedToolDefinitions>();

/**
 * Build a stable cache key from an invocation target.
 * For binary plugins: the executable path.
 * For bun-package plugins: the entry path within the plugin directory.
 */
function targetCacheKey(target: PluginInvocationTarget): string {
	if (target.kind === "binary") {
		return target.executablePath;
	}
	return `${target.cwd}:${target.entryPath}`;
}

/**
 * Stat the relevant file for cache invalidation.
 * For binary plugins: the executable itself.
 * For bun-package plugins: the entry file (changes when plugin code changes).
 */
function statTarget(
	target: PluginInvocationTarget,
): { mtimeMs: number } | null {
	const statPath =
		target.kind === "binary" ? target.executablePath : target.entryPath;
	try {
		const stat = fs.statSync(statPath);
		return { mtimeMs: stat.mtimeMs };
	} catch {
		return null;
	}
}

/**
 * Returns cached plugin tool definitions when the target, mtime, version,
 * and protocol version all match. Avoids spawning `tools list` on every turn
 * for unchanged plugins.
 */
export function getCachedPluginToolDefinitions(params: {
	readonly target: PluginInvocationTarget;
	readonly version: string;
	readonly protocolVersion: string;
}): NonNullable<PluginToolsListResponse["tools"]> | null {
	const key = targetCacheKey(params.target);
	const entry = cache.get(key);
	if (!entry) return null;
	const stat = statTarget(params.target);
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
	readonly target: PluginInvocationTarget;
	readonly version: string;
	readonly protocolVersion: string;
	readonly tools: NonNullable<PluginToolsListResponse["tools"]>;
}): void {
	const stat = statTarget(params.target);
	if (!stat) return;
	cache.set(targetCacheKey(params.target), {
		cacheKey: targetCacheKey(params.target),
		mtimeMs: stat.mtimeMs,
		version: params.version,
		protocolVersion: params.protocolVersion,
		tools: params.tools,
	});
}

export function clearPluginToolDefinitionCache(): void {
	cache.clear();
}
