import type { IntegrationModule } from "../types";
import {
	type PluginMetadata,
	createPluginIntegrationModule,
	getPluginMetadataRecord,
	loadPluginMetadata,
	rememberPluginMetadata,
} from "./adapter";
import { pluginToolsList } from "./client";
import { discoverPluginBinaries, findPluginBinary } from "./discovery";
import { readDisabledPluginNames } from "./list-status";
import { migrateLegacyPluginCredentials } from "./migrate";
import type { DiscoveredPlugin } from "./protocol";
import { resolvePluginTarget } from "./runtime";
import { setCachedPluginToolDefinitions } from "./tool-def-cache";

let cachedPluginModules: IntegrationModule[] | null = null;

export function getPluginModules(): IntegrationModule[] {
	if (cachedPluginModules) {
		return cachedPluginModules;
	}
	cachedPluginModules = loadDiscoveredPluginModules();
	return cachedPluginModules;
}

export function resetPluginModuleCache(): void {
	cachedPluginModules = null;
}

function loadDiscoveredPluginModules(): IntegrationModule[] {
	migrateLegacyPluginCredentials();
	const disabled = readDisabledPluginNames();
	const modules: IntegrationModule[] = [];

	for (const discovered of discoverPluginBinaries()) {
		const metadata = loadPluginMetadataSafe(discovered, disabled);
		if (!metadata) continue;
		modules.push(createPluginIntegrationModule(metadata));
	}

	return modules.sort((a, b) => a.name.localeCompare(b.name));
}

function loadPluginMetadataSafe(
	discovered: DiscoveredPlugin,
	disabled: Set<string>,
): PluginMetadata | null {
	const parsedName = discovered.binaryName.replace(/^toby-plugin-/, "");
	if (disabled.has(parsedName)) return null;

	const loaded = loadPluginMetadata(discovered);
	if ("error" in loaded) {
		return null;
	}
	rememberPluginMetadata(loaded);
	return loaded;
}

export {
	collectPluginListEntries,
	readDisabledPluginNames,
	type PluginListEntry,
	type PluginListEntryState,
} from "./list-status";

export function getDiscoveredPluginBinaries(): DiscoveredPlugin[] {
	return discoverPluginBinaries();
}

export function findDiscoveredPlugin(
	name: string,
): DiscoveredPlugin | undefined {
	return findPluginBinary(name);
}

export function getPluginMetadata(name: string): PluginMetadata | undefined {
	return getPluginMetadataRecord().get(name);
}

export {
	createPluginIntegrationModule,
	getPluginMetadataRecord,
	inspectPluginBinary,
	loadPluginMetadata,
	type PluginMetadata,
} from "./adapter";
export {
	discoverPluginBinaries,
	findPluginBinary,
	resolvePluginSearchDirectories,
} from "./discovery";
export * from "./protocol";
export {
	pluginConnect,
	pluginDisconnect,
	pluginStatus,
	pluginToolsList,
} from "./client";
export { clearPluginToolDefinitionCache } from "./tool-def-cache";
export {
	discoverPollablePlugins,
	startPluginPollingLoop,
} from "./poller";

/**
 * Pre-populate plugin tool-definition cache for all discovered, enabled plugins.
 * Call at daemon/session ready to avoid spawning `tools list` on the first turn.
 * Errors are swallowed (best-effort warmup).
 */
export function warmupPluginToolDefinitions(): void {
	const disabled = readDisabledPluginNames();
	for (const discovered of discoverPluginBinaries()) {
		const parsedName = discovered.binaryName.replace(/^toby-plugin-/, "");
		if (disabled.has(parsedName)) continue;
		const loaded = loadPluginMetadata(discovered);
		if ("error" in loaded) continue;
		rememberPluginMetadata(loaded);
		const result = pluginToolsList(loaded.target);
		if (result.ok && result.data.ok && result.data.tools) {
			setCachedPluginToolDefinitions({
				target: loaded.target,
				version: loaded.version,
				protocolVersion: loaded.protocolVersion,
				tools: result.data.tools,
			});
		}
	}
}
