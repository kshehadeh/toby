import fs from "node:fs";
import path from "node:path";
import { ensureTobyDir, getPluginsDir } from "../../config/index";
import { isBuiltinIntegration } from "../index";
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
import { resetPluginModuleCache } from "./registry";
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
		return toDiscoveredPlugin(resolved);
	}

	if (!stat.isDirectory()) {
		throw new PluginInstallException(
			`Path is not a file or directory: ${input}`,
			"invalid_path",
		);
	}

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

	return toDiscoveredPlugin(candidates[0] as string);
}

export function validatePluginForInstall(
	discovered: DiscoveredPlugin,
): PluginInstallResult | PluginInstallError {
	const parsedName = parsePluginNameFromBinary(discovered.binaryName);
	if (!parsedName) {
		return {
			error: `Binary must be named ${PLUGIN_BINARY_PREFIX}<name>; got "${discovered.binaryName}"`,
			code: "invalid_name",
		};
	}

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
		fs.rmSync(installPath, { force: true });
	}

	const sourcePath = path.resolve(discovered.binaryPath);
	if (options.link) {
		fs.symlinkSync(sourcePath, installPath);
	} else {
		copyBinaryAtomic(sourcePath, installPath);
	}

	resetPluginModuleCache();

	return {
		name: preview.name,
		displayName: preview.displayName,
		version: preview.version,
		installPath,
		linked: Boolean(options.link),
	};
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

	const toolNames = listPluginToolNames(installPath);
	notifyPluginDisconnect(installPath, normalized);
	const purged = purgePluginArtifacts(normalized, { toolNames });

	fs.rmSync(installPath, { force: true });
	resetPluginModuleCache();

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

function toDiscoveredPlugin(binaryPath: string): DiscoveredPlugin {
	const binaryName = path.basename(binaryPath);
	const parsedName = parsePluginNameFromBinary(binaryName);
	if (!parsedName) {
		throw new PluginInstallException(
			`Binary must be named ${PLUGIN_BINARY_PREFIX}<name>; got "${binaryName}"`,
			"invalid_name",
		);
	}
	return { binaryPath, binaryName };
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
