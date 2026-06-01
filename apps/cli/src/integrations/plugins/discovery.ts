import fs from "node:fs";
import path from "node:path";
import { getPluginsDir } from "../../config/index";
import {
	type DiscoveredPlugin,
	PLUGIN_BINARY_PREFIX,
	parsePluginNameFromBinary,
} from "./protocol";

export function resolvePluginSearchDirectories(): string[] {
	return [getPluginsDir()];
}

function listPluginBinariesInDirectory(directory: string): DiscoveredPlugin[] {
	if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
		return [];
	}

	const entries = fs.readdirSync(directory, { withFileTypes: true });
	const plugins: DiscoveredPlugin[] = [];

	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const binaryName = entry.name;
		if (!binaryName.startsWith(PLUGIN_BINARY_PREFIX)) continue;
		if (!parsePluginNameFromBinary(binaryName)) continue;

		const binaryPath = path.join(directory, binaryName);
		try {
			fs.accessSync(binaryPath, fs.constants.X_OK);
		} catch {
			continue;
		}

		plugins.push({ binaryPath, binaryName });
	}

	return plugins;
}

export function discoverPluginBinaries(): DiscoveredPlugin[] {
	return listPluginBinariesInDirectory(getPluginsDir()).sort((a, b) =>
		a.binaryName.localeCompare(b.binaryName),
	);
}

export function findPluginBinary(name: string): DiscoveredPlugin | undefined {
	const expectedName = `${PLUGIN_BINARY_PREFIX}${name}`;
	return discoverPluginBinaries().find((p) => p.binaryName === expectedName);
}
