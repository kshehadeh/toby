import fs from "node:fs";
import path from "node:path";
import { getPluginsDir } from "../../config/index";
import { parseManifest } from "./manifest";
import {
	type DiscoveredPlugin,
	PLUGIN_BINARY_PREFIX,
	parsePluginNameFromBinary,
} from "./protocol";

function dirContainsPlugin(directory: string): boolean {
	try {
		if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
			return false;
		}
		const entries = fs.readdirSync(directory, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() && !entry.isSymbolicLink() && !entry.isDirectory()) {
				continue;
			}
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
		return dirContainsPlugin(execDir) ? execDir : null;
	} catch {
		return null;
	}
}

function getRepoDistPluginsDirectoryIfPopulated(): string | null {
	try {
		const distDir = path.resolve(process.cwd(), "dist");
		const pluginsDir = path.resolve(getPluginsDir());
		if (distDir === pluginsDir) return null;
		return dirContainsPlugin(distDir) ? distDir : null;
	} catch {
		return null;
	}
}

export function resolvePluginSearchDirectories(): string[] {
	const dirs: string[] = [];
	const local = getLocalPluginsDirectoryIfPopulated();
	if (local) dirs.push(local);
	const repoDist = getRepoDistPluginsDirectoryIfPopulated();
	if (repoDist) dirs.push(repoDist);
	dirs.push(getPluginsDir());
	return Array.from(new Set(dirs));
}

function listPluginsInDirectory(directory: string): DiscoveredPlugin[] {
	if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
		return [];
	}

	const entries = fs.readdirSync(directory, { withFileTypes: true });
	const plugins: DiscoveredPlugin[] = [];
	const seenNames = new Set<string>();

	for (const entry of entries) {
		const name = entry.name;
		if (!name.startsWith(PLUGIN_BINARY_PREFIX)) continue;
		if (!parsePluginNameFromBinary(name)) continue;

		// Binary plugin: file or symlink
		if (entry.isFile() || entry.isSymbolicLink()) {
			// Skip if a directory with the same name already discovered this plugin
			if (seenNames.has(name)) continue;
			const binaryPath = path.join(directory, name);
			try {
				fs.accessSync(binaryPath, fs.constants.X_OK);
			} catch {
				continue;
			}
			plugins.push({ kind: "binary", binaryName: name, binaryPath });
			seenNames.add(name);
			continue;
		}

		// Bun-package plugin: directory with manifest.json
		if (entry.isDirectory()) {
			// Skip if a binary with the same name already discovered this plugin
			if (seenNames.has(name)) continue;
			const directoryPath = path.join(directory, name);
			const manifestPath = path.join(directoryPath, "manifest.json");
			if (!fs.existsSync(manifestPath)) continue;

			const manifestResult = parseManifest(directoryPath);
			if (!manifestResult.ok) continue;

			const entryPath = path.resolve(
				directoryPath,
				manifestResult.manifest.runtime.entry,
			);
			if (!fs.existsSync(entryPath)) continue;

			plugins.push({
				kind: "bun-package",
				binaryName: name,
				directoryPath,
				manifestPath,
				entryPath,
			});
			seenNames.add(name);
		}
	}

	return plugins;
}

export function discoverPluginBinaries(): DiscoveredPlugin[] {
	const seen = new Set<string>();
	const results: DiscoveredPlugin[] = [];
	for (const dir of resolvePluginSearchDirectories()) {
		for (const plugin of listPluginsInDirectory(dir)) {
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
