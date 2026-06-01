import { readConfig } from "../../config/index";
import type { IntegrationModule } from "../types";
import {
	type PluginMetadata,
	createPluginIntegrationModule,
	getPluginMetadataRecord,
	loadPluginMetadata,
	rememberPluginMetadata,
} from "./adapter";
import { discoverPluginBinaries, findPluginBinary } from "./discovery";
import type { DiscoveredPlugin } from "./protocol";

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

function readDisabledPluginNames(): Set<string> {
	try {
		const config = readConfig() as { plugins?: { disabled?: string[] } };
		return new Set(
			(config.plugins?.disabled ?? []).filter((n) => typeof n === "string"),
		);
	} catch {
		return new Set();
	}
}

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
