import fs from "node:fs";
import path from "node:path";
import { getPluginsDir } from "../../config/index";
import { parseManifest } from "./manifest";
import {
	type DiscoveredPlugin,
	PLUGIN_BINARY_PREFIX,
	parsePluginNameFromBinary,
} from "./protocol";

function directoryContainsPluginArtifacts(directory: string): boolean {
	if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
		return false;
	}
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.some((entry) => entry.name.startsWith(PLUGIN_BINARY_PREFIX));
}

function addPluginDirectory(
	directories: string[],
	seen: Set<string>,
	directory: string,
	options: { requireArtifacts?: boolean } = {},
): void {
	const resolved = path.resolve(directory);
	if (seen.has(resolved)) return;
	if (options.requireArtifacts && !directoryContainsPluginArtifacts(resolved)) {
		return;
	}
	seen.add(resolved);
	directories.push(resolved);
}

function resolveRepoDistDirectory(): string {
	return path.resolve(import.meta.dirname, "../../../../../dist");
}

/**
 * Resolve the list of directories to search for plugins.
 *
 * When `TOBY_PLUGINS_DIR` env var is set, only that directory is searched
 * (development override). Otherwise, search app-bundled/compiled-adjacent
 * plugins, then repo `dist/`, then `~/.toby/plugins/` for installed plugins.
 */
export function resolvePluginSearchDirectories(): string[] {
	const envDir = process.env.TOBY_PLUGINS_DIR?.trim();
	if (envDir) {
		const resolved = path.resolve(envDir);
		if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
			return [resolved];
		}
	}

	const directories: string[] = [];
	const seen = new Set<string>();

	addPluginDirectory(directories, seen, path.dirname(process.execPath), {
		requireArtifacts: true,
	});
	addPluginDirectory(directories, seen, resolveRepoDistDirectory(), {
		requireArtifacts: true,
	});
	addPluginDirectory(directories, seen, getPluginsDir());

	return directories;
}

/**
 * Try to discover a bun-package plugin at `directoryPath`.
 * Returns null when the path is not a valid bun-package plugin directory.
 */
function tryDiscoverBunPackage(
	binaryName: string,
	directoryPath: string,
): Extract<DiscoveredPlugin, { kind: "bun-package" }> | null {
	const manifestPath = path.join(directoryPath, "manifest.json");
	if (!fs.existsSync(manifestPath)) return null;

	const manifestResult = parseManifest(directoryPath);
	if (!manifestResult.ok) return null;

	const entryPath = path.resolve(
		directoryPath,
		manifestResult.manifest.runtime.entry,
	);
	if (!fs.existsSync(entryPath)) return null;

	return {
		kind: "bun-package",
		binaryName,
		directoryPath,
		manifestPath,
		entryPath,
	};
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
		if (seenNames.has(name)) continue;

		const fullPath = path.join(directory, name);

		// Resolve through symlinks so a symlink → plugin directory is treated as
		// bun-package, not as a binary executable path (which yields EACCES).
		let realStat: fs.Stats;
		try {
			realStat = fs.statSync(fullPath);
		} catch {
			continue;
		}

		// Bun-package plugin: directory with manifest.json (preferred).
		if (realStat.isDirectory()) {
			const discovered = tryDiscoverBunPackage(name, fullPath);
			if (!discovered) continue;
			plugins.push(discovered);
			seenNames.add(name);
			continue;
		}

		// Binary plugin: regular executable file.
		if (realStat.isFile()) {
			try {
				fs.accessSync(fullPath, fs.constants.X_OK);
			} catch {
				continue;
			}
			plugins.push({ kind: "binary", binaryName: name, binaryPath: fullPath });
			seenNames.add(name);
		}
	}

	return plugins;
}

/**
 * Stable fingerprint of the current on-disk plugin set (name, kind, path).
 * Used to invalidate the in-memory plugin module cache when dist/ plugins are
 * rebuilt or replaced without restarting the daemon.
 */
export function pluginDiscoveryFingerprint(): string {
	return discoverPluginBinaries()
		.map((p) => {
			const loc =
				p.kind === "binary"
					? p.binaryPath
					: `${p.directoryPath}@${p.entryPath}`;
			return `${p.binaryName}:${p.kind}:${loc}`;
		})
		.join("\n");
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

export function resolveActivePluginDirectory(): string | null {
	for (const dir of resolvePluginSearchDirectories()) {
		if (listPluginsInDirectory(dir).length > 0) {
			return dir;
		}
	}
	return resolvePluginSearchDirectories()[0] ?? null;
}
