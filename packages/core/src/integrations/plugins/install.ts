import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureTobyDir, getPluginsDir } from "../../config/index";
import { refreshPluginsAndSettings } from "../../configure/settings-cache";
import { isBuiltinIntegration } from "../index";
import { pluginStatus } from "./client";
import { parseManifest, validateManifest } from "./manifest";
import {
	type DiscoveredPlugin,
	PLUGIN_BINARY_PREFIX,
	parsePluginNameFromBinary,
} from "./protocol";
import {
	type PluginPurgeResult,
	listPluginToolNames,
	notifyPluginDisconnect,
	purgePluginArtifacts,
} from "./purge";
import { resolveBunRuntime, resolvePluginTarget } from "./runtime";
import { validatePluginBinary } from "./validate";

export type PluginInstallError = {
	readonly error: string;
	readonly code: string;
};

export type PluginInstallResult = {
	readonly name: string;
	readonly displayName: string;
	readonly version: string;
	readonly installPath: string;
	readonly linked: boolean;
	readonly setupAvailable: boolean;
	readonly setupDescription?: string;
};

export type PluginUninstallResult = {
	readonly name: string;
	readonly removedPath: string;
	readonly purged: PluginPurgeResult;
};

export function resolvePluginsInstallDir(): string {
	return getPluginsDir();
}

export function resolvePluginInstallTarget(name: string): string {
	return path.join(getPluginsDir(), `${PLUGIN_BINARY_PREFIX}${name}`);
}

export function resolvePluginSourcePath(input: string): DiscoveredPlugin {
	const resolved = path.resolve(input);
	if (!fs.existsSync(resolved)) {
		throw new PluginInstallException(
			`Path not found: ${input}`,
			"path_not_found",
		);
	}

	const stat = fs.statSync(resolved);
	if (stat.isFile()) {
		return toDiscoveredBinaryPlugin(resolved);
	}

	if (!stat.isDirectory()) {
		throw new PluginInstallException(
			`Path is not a file or directory: ${input}`,
			"invalid_path",
		);
	}

	// Check if the directory itself is a bun-package plugin (has manifest.json)
	// The directory may or may not be named toby-plugin-<name> — the manifest's
	// name field is the source of truth for the plugin name.
	if (fs.existsSync(path.join(resolved, "manifest.json"))) {
		return toDiscoveredBunPackagePlugin(resolved);
	}

	// Existing behavior: look for plugin binaries inside the directory
	const candidates = fs
		.readdirSync(resolved, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.startsWith(PLUGIN_BINARY_PREFIX) &&
				parsePluginNameFromBinary(entry.name) !== null,
		)
		.map((entry) => path.join(resolved, entry.name))
		.filter((candidate) => isExecutable(candidate));

	if (candidates.length === 0) {
		throw new PluginInstallException(
			`No executable ${PLUGIN_BINARY_PREFIX}<name> binary found in ${input}`,
			"plugin_not_found",
		);
	}

	if (candidates.length > 1) {
		throw new PluginInstallException(
			`Directory contains multiple plugin binaries; specify the file directly: ${candidates.map((p) => path.basename(p)).join(", ")}`,
			"ambiguous_directory",
		);
	}

	return toDiscoveredBinaryPlugin(candidates[0] as string);
}

export function validatePluginForInstall(
	discovered: DiscoveredPlugin,
): PluginInstallResult | PluginInstallError {
	const parsedName = parsePluginNameFromBinary(discovered.binaryName);
	if (!parsedName) {
		return {
			error: `Plugin must be named ${PLUGIN_BINARY_PREFIX}<name>; got "${discovered.binaryName}"`,
			code: "invalid_name",
		};
	}

	if (discovered.kind === "bun-package") {
		return validateBunPackageForInstall(discovered, parsedName);
	}

	return validateBinaryForInstall(discovered, parsedName);
}

function validateBinaryForInstall(
	discovered: Extract<DiscoveredPlugin, { kind: "binary" }>,
	parsedName: string,
): PluginInstallResult | PluginInstallError {
	if (!isExecutable(discovered.binaryPath)) {
		return {
			error: `Plugin binary is not executable: ${discovered.binaryPath}`,
			code: "not_executable",
		};
	}

	const validated = validatePluginBinary(discovered);
	if (!validated.ok) {
		return { error: validated.error, code: validated.code };
	}

	if (isBuiltinIntegration(validated.metadata.name)) {
		return {
			error: `Plugin name "${validated.metadata.name}" conflicts with a built-in integration`,
			code: "builtin_collision",
		};
	}

	return {
		name: validated.metadata.name,
		displayName: validated.metadata.displayName,
		version: validated.metadata.version,
		installPath: resolvePluginInstallTarget(validated.metadata.name),
		linked: false,
		setupAvailable: validated.metadata.setupAvailable ?? false,
		setupDescription: validated.metadata.setupDescription,
	};
}

function validateBunPackageForInstall(
	discovered: Extract<DiscoveredPlugin, { kind: "bun-package" }>,
	parsedName: string,
): PluginInstallResult | PluginInstallError {
	const manifestResult = parseManifest(discovered.directoryPath);
	if (!manifestResult.ok) {
		return { error: manifestResult.error, code: manifestResult.code };
	}

	const manifest = manifestResult.manifest;
	const validation = validateManifest(
		manifest,
		discovered.directoryPath,
		discovered.binaryName,
	);
	if (!validation.ok) {
		return { error: validation.error, code: validation.code };
	}

	if (isBuiltinIntegration(manifest.name)) {
		return {
			error: `Plugin name "${manifest.name}" conflicts with a built-in integration`,
			code: "builtin_collision",
		};
	}

	return {
		name: manifest.name,
		displayName: manifest.displayName,
		version: manifest.version,
		installPath: resolvePluginInstallTarget(manifest.name),
		linked: false,
		setupAvailable: false,
	};
}

export function installPlugin(
	sourceInput: string,
	options: { force?: boolean; link?: boolean } = {},
): PluginInstallResult {
	const discovered = resolvePluginSourcePath(sourceInput);
	const preview = validatePluginForInstall(discovered);
	if ("error" in preview) {
		throw new PluginInstallException(preview.error, preview.code);
	}

	const installPath = preview.installPath;
	if (fs.existsSync(installPath) && !options.force) {
		throw new PluginInstallException(
			`Plugin already installed at ${installPath}. Use --force to overwrite or run "toby plugins uninstall ${preview.name}" first.`,
			"already_installed",
		);
	}

	ensureTobyDir();
	fs.mkdirSync(getPluginsDir(), { recursive: true });

	if (fs.existsSync(installPath)) {
		fs.rmSync(installPath, { force: true, recursive: true });
	}

	if (discovered.kind === "bun-package") {
		installBunPackagePlugin(discovered, installPath, options);
	} else {
		installBinaryPlugin(discovered, installPath, options);
	}

	refreshPluginsAndSettings();

	// Verify installation by running status
	const target = resolvePluginTarget(
		discovered.kind === "bun-package"
			? {
					kind: "bun-package",
					binaryName: discovered.binaryName,
					directoryPath: installPath,
					manifestPath: path.join(installPath, "manifest.json"),
					entryPath: path.join(
						installPath,
						discovered.entryPath
							.replace(discovered.directoryPath, "")
							.replace(/^\//, ""),
					),
				}
			: {
					kind: "binary",
					binaryName: discovered.binaryName,
					binaryPath: installPath,
				},
	);

	const statusResult = pluginStatus(target);
	const setupAvailable =
		statusResult.ok &&
		statusResult.data.ok &&
		Boolean(statusResult.data.setupAvailable);
	const setupDescription =
		statusResult.ok && statusResult.data.ok
			? statusResult.data.setupDescription
			: undefined;

	return {
		name: preview.name,
		displayName: preview.displayName,
		version: preview.version,
		installPath,
		linked: Boolean(options.link),
		setupAvailable,
		setupDescription,
	};
}

function installBinaryPlugin(
	discovered: Extract<DiscoveredPlugin, { kind: "binary" }>,
	installPath: string,
	options: { force?: boolean; link?: boolean },
): void {
	const sourcePath = path.resolve(discovered.binaryPath);
	if (options.link) {
		fs.symlinkSync(sourcePath, installPath);
		copyAdjacentPluginResourceBundles(sourcePath, getPluginsDir(), {
			link: true,
		});
	} else {
		copyBinaryAtomic(sourcePath, installPath);
		copyAdjacentPluginResourceBundles(sourcePath, getPluginsDir());
	}
}

function installBunPackagePlugin(
	discovered: Extract<DiscoveredPlugin, { kind: "bun-package" }>,
	installPath: string,
	options: { force?: boolean; link?: boolean },
): void {
	const sourcePath = path.resolve(discovered.directoryPath);

	if (options.link) {
		fs.symlinkSync(sourcePath, installPath);
	} else {
		// Copy the directory atomically
		const tempDestination = path.join(
			path.dirname(installPath),
			`.toby-plugin-dir-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		);
		fs.cpSync(sourcePath, tempDestination, { recursive: true });
		fs.renameSync(tempDestination, installPath);
	}

	// Install dependencies. Remove any node_modules that may contain broken
	// symlinks from the monorepo's hoisted dependencies before running bun install.
	const nodeModulesPath = path.join(installPath, "node_modules");
	if (fs.existsSync(nodeModulesPath)) {
		fs.rmSync(nodeModulesPath, { force: true, recursive: true });
	}
	{
		const runtime = resolveBunRuntime();
		if (runtime.ok) {
			try {
				execSync(`${JSON.stringify(runtime.bunPath)} install`, {
					cwd: installPath,
					stdio: "pipe",
					timeout: 60_000,
				});
			} catch {
				// Best-effort: plugin may work without dependencies or with vendored ones
			}
		}
	}
}

export function uninstallPlugin(name: string): PluginUninstallResult {
	const normalized = name.trim();
	if (!normalized) {
		throw new PluginInstallException("Plugin name is required", "invalid_name");
	}

	const installPath = resolvePluginInstallTarget(normalized);
	if (!fs.existsSync(installPath)) {
		throw new PluginInstallException(
			`Plugin "${normalized}" is not installed in ${getPluginsDir()}. Run "toby plugins list" to see discovered plugins.`,
			"not_installed",
		);
	}

	// Resolve target for disconnect/tool-list calls
	const stat = fs.statSync(installPath);
	let target:
		| { kind: "binary"; executablePath: string }
		| { kind: "bun-package"; bunPath: string; cwd: string; entryPath: string }
		| null = null;

	if (stat.isFile()) {
		target = { kind: "binary", executablePath: installPath };
	} else if (stat.isDirectory()) {
		const manifestResult = parseManifest(installPath);
		if (manifestResult.ok) {
			const runtime = resolveBunRuntime();
			if (runtime.ok) {
				target = {
					kind: "bun-package",
					bunPath: runtime.bunPath,
					cwd: installPath,
					entryPath: path.resolve(
						installPath,
						manifestResult.manifest.runtime.entry,
					),
				};
			}
		}
	}

	if (target) {
		const toolNames = listPluginToolNames(target);
		notifyPluginDisconnect(target, normalized);
		const purged = purgePluginArtifacts(normalized, { toolNames });
		fs.rmSync(installPath, { force: true, recursive: stat.isDirectory() });
		refreshPluginsAndSettings();
		return { name: normalized, removedPath: installPath, purged };
	}

	// Fallback: just remove and purge without plugin calls
	const purged = purgePluginArtifacts(normalized);
	fs.rmSync(installPath, { force: true, recursive: stat.isDirectory() });
	refreshPluginsAndSettings();
	return { name: normalized, removedPath: installPath, purged };
}

export class PluginInstallException extends Error {
	readonly code: string;

	constructor(message: string, code: string) {
		super(message);
		this.name = "PluginInstallException";
		this.code = code;
	}
}

function toDiscoveredBinaryPlugin(binaryPath: string): DiscoveredPlugin {
	const binaryName = path.basename(binaryPath);
	const parsedName = parsePluginNameFromBinary(binaryName);
	if (!parsedName) {
		throw new PluginInstallException(
			`Binary must be named ${PLUGIN_BINARY_PREFIX}<name>; got "${binaryName}"`,
			"invalid_name",
		);
	}
	return { kind: "binary", binaryName, binaryPath };
}

function toDiscoveredBunPackagePlugin(directoryPath: string): DiscoveredPlugin {
	const dirName = path.basename(directoryPath);

	const manifestPath = path.join(directoryPath, "manifest.json");
	const manifestResult = parseManifest(directoryPath);
	if (!manifestResult.ok) {
		throw new PluginInstallException(manifestResult.error, manifestResult.code);
	}

	// The binaryName is always toby-plugin-<name>, derived from the manifest's
	// name field (not the directory name, which may differ in monorepo layouts).
	const binaryName = `${PLUGIN_BINARY_PREFIX}${manifestResult.manifest.name}`;

	const entryPath = path.resolve(
		directoryPath,
		manifestResult.manifest.runtime.entry,
	);

	return {
		kind: "bun-package",
		binaryName,
		directoryPath,
		manifestPath,
		entryPath,
	};
}

function isExecutable(filePath: string): boolean {
	try {
		fs.accessSync(filePath, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function copyBinaryAtomic(source: string, destination: string): void {
	const tempDestination = path.join(
		path.dirname(destination),
		`.toby-plugin-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	fs.copyFileSync(source, tempDestination);
	fs.chmodSync(tempDestination, 0o755);
	fs.renameSync(tempDestination, destination);
}

export function copyPluginResourceBundlesFromSource(
	sourceBinaryPath: string,
	destinationDir: string = getPluginsDir(),
	options: { link?: boolean } = {},
): void {
	copyAdjacentPluginResourceBundles(sourceBinaryPath, destinationDir, options);
}

function copyAdjacentPluginResourceBundles(
	sourceBinaryPath: string,
	destinationDir: string,
	options: { link?: boolean } = {},
): void {
	const sourceDir = path.dirname(path.resolve(sourceBinaryPath));
	let entries: string[];
	try {
		entries = fs.readdirSync(sourceDir);
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.endsWith(".bundle")) {
			continue;
		}
		const sourceBundle = path.join(sourceDir, entry);
		let stat: fs.Stats;
		try {
			stat = fs.statSync(sourceBundle);
		} catch {
			continue;
		}
		if (!stat.isDirectory()) {
			continue;
		}

		const destinationBundle = path.join(destinationDir, entry);
		if (path.resolve(sourceBundle) === path.resolve(destinationBundle)) {
			continue;
		}
		if (fs.existsSync(destinationBundle)) {
			fs.rmSync(destinationBundle, { recursive: true, force: true });
		}

		if (options.link) {
			fs.symlinkSync(sourceBundle, destinationBundle);
			continue;
		}

		fs.cpSync(sourceBundle, destinationBundle, { recursive: true });
	}
}
