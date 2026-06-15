import fs from "node:fs";
import path from "node:path";
import { getPluginsDir } from "../../config/index";
import {
	type DiscoveredPlugin,
	PLUGIN_BINARY_PREFIX,
	parsePluginNameFromBinary,
} from "./protocol";

function dirContainsPluginBinary(directory: string): boolean {
	try {
		if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
			return false;
		}
		const entries = fs.readdirSync(directory, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() && !entry.isSymbolicLink()) continue;
			if (!entry.name.startsWith(PLUGIN_BINARY_PREFIX)) continue;
			if (!parsePluginNameFromBinary(entry.name)) continue;
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

function getLocalPluginsDirectoryIfPopulated(): string | null {
	try {
		const execPath = process.execPath;
		if (!execPath) return null;
		const execDir = path.resolve(path.dirname(execPath));
		const pluginsDir = path.resolve(getPluginsDir());
		if (execDir === pluginsDir) return null;
		return dirContainsPluginBinary(execDir) ? execDir : null;
	} catch {
		return null;
	}
}

export function resolvePluginSearchDirectories(): string[] {
	const dirs: string[] = [];
	const local = getLocalPluginsDirectoryIfPopulated();
	if (local) dirs.push(local);
	dirs.push(getPluginsDir());
	return dirs;
}

function listPluginBinariesInDirectory(directory: string): DiscoveredPlugin[] {
	if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
		return [];
	}

	const entries = fs.readdirSync(directory, { withFileTypes: true });
	const plugins: DiscoveredPlugin[] = [];

	for (const entry of entries) {
		// Include symlinks (--link installs); Dirent.isFile() is false for links.
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
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
	const seen = new Set<string>();
	const results: DiscoveredPlugin[] = [];
	for (const dir of resolvePluginSearchDirectories()) {
		for (const plugin of listPluginBinariesInDirectory(dir)) {
			if (seen.has(plugin.binaryName)) continue;
			seen.add(plugin.binaryName);
			results.push(plugin);
		}
	}
	return results.sort((a, b) => a.binaryName.localeCompare(b.binaryName));
}

export function findPluginBinary(name: string): DiscoveredPlugin | undefined {
	const expectedName = `${PLUGIN_BINARY_PREFIX}${name}`;
	return discoverPluginBinaries().find((p) => p.binaryName === expectedName);
}
