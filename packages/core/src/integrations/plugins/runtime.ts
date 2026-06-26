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
 * 2. `~/.toby/helpers/bun` (bundled in release installs)
 * 3. `bun` on PATH (development mode)
 */
export function resolveBunRuntime(): BunRuntimeResult {
	const envPath = process.env.TOBY_BUN_PATH?.trim();
	if (envPath && fs.existsSync(envPath)) {
		return { ok: true, bunPath: envPath };
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
 * Convert a discovered plugin descriptor into an invocation target
 * suitable for the plugin client subprocess functions.
 *
 * Throws if a bun-package plugin is discovered but no Bun runtime is available.
 */
export function resolvePluginTarget(
	discovered: DiscoveredPlugin,
): PluginInvocationTarget {
	if (discovered.kind === "binary") {
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
