import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getHelpersDir } from "../../config/index";
import type { DiscoveredPlugin, PluginInvocationTarget } from "./protocol";

export type BunRuntimeResult =
	| { readonly ok: true; readonly bunPath: string }
	| { readonly ok: false; readonly error: string };

/**
 * Resolve a Bun runtime executable for executing TypeScript package plugins.
 *
 * Search order:
 * 1. `TOBY_BUN_PATH` env var (explicit override, dev/diagnostics)
 * 2. `bun` next to the compiled CLI executable (self-contained app bundle)
 * 3. `~/.toby/helpers/bun` (bundled in release installs)
 * 4. `bun` on PATH (development mode)
 */
export function resolveBunRuntime(): BunRuntimeResult {
	const envPath = process.env.TOBY_BUN_PATH?.trim();
	if (envPath && fs.existsSync(envPath)) {
		return { ok: true, bunPath: envPath };
	}

	// Check for bun next to the running executable (self-contained app bundle)
	const siblingBun = path.join(path.dirname(process.execPath), "bun");
	if (fs.existsSync(siblingBun)) {
		return { ok: true, bunPath: siblingBun };
	}

	const helpersBun = path.join(getHelpersDir(), "bun");
	if (fs.existsSync(helpersBun)) {
		return { ok: true, bunPath: helpersBun };
	}

	try {
		const which = execSync("command -v bun", { encoding: "utf8" }).trim();
		if (which) {
			return { ok: true, bunPath: which };
		}
	} catch {
		// bun not on PATH
	}

	return {
		ok: false,
		error:
			"Bun runtime not found. Set TOBY_BUN_PATH, install bun to ~/.toby/helpers/bun, or ensure bun is on PATH.",
	};
}

/**
 * If `directoryPath` looks like a bun-package plugin, resolve a bun-package
 * invocation target. Returns null when it is not a valid package directory.
 */
function tryResolveBunPackageTarget(
	directoryPath: string,
): PluginInvocationTarget | null {
	const manifestPath = path.join(directoryPath, "manifest.json");
	if (
		!fs.existsSync(manifestPath) ||
		!fs.statSync(directoryPath).isDirectory()
	) {
		return null;
	}
	let entryRel: string;
	try {
		const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
			runtime?: { entry?: string };
		};
		entryRel = raw.runtime?.entry?.trim() ?? "";
	} catch {
		return null;
	}
	if (!entryRel) return null;
	const entryPath = path.resolve(directoryPath, entryRel);
	if (!fs.existsSync(entryPath)) return null;

	const runtime = resolveBunRuntime();
	if (!runtime.ok) {
		throw new Error(runtime.error);
	}
	return {
		kind: "bun-package",
		bunPath: runtime.bunPath,
		cwd: directoryPath,
		entryPath,
	};
}

/**
 * Convert a discovered plugin descriptor into an invocation target
 * suitable for the plugin client subprocess functions.
 *
 * Throws if a bun-package plugin is discovered but no Bun runtime is available.
 *
 * Recovery: if a descriptor claims `binary` but the path is actually a
 * bun-package directory (common after `bun run build:plugins` replaces old
 * compiled binaries with directories without restarting the daemon), upgrade
 * to a bun-package target instead of spawning the directory (EACCES).
 */
export function resolvePluginTarget(
	discovered: DiscoveredPlugin,
): PluginInvocationTarget {
	if (discovered.kind === "binary") {
		// Stale binary descriptor after a bun-package rebuild into the same path.
		try {
			if (fs.statSync(discovered.binaryPath).isDirectory()) {
				const upgraded = tryResolveBunPackageTarget(discovered.binaryPath);
				if (upgraded) return upgraded;
			}
		} catch {
			// Fall through to binary target; spawn will surface the real error.
		}
		return { kind: "binary", executablePath: discovered.binaryPath };
	}

	const runtime = resolveBunRuntime();
	if (!runtime.ok) {
		throw new Error(runtime.error);
	}

	return {
		kind: "bun-package",
		bunPath: runtime.bunPath,
		cwd: discovered.directoryPath,
		entryPath: discovered.entryPath,
	};
}
