import fs from "node:fs";
import { pluginSetup } from "./client";
import { discoverPluginBinaries } from "./discovery";
import { resolvePluginInstallTarget } from "./install";
import type { PluginSetupActionResult, PluginSetupResponse } from "./protocol";

export type PluginSetupRunResult =
	| {
			readonly ok: true;
			readonly name: string;
			readonly binaryPath: string;
			readonly response: PluginSetupResponse;
	  }
	| {
			readonly ok: false;
			readonly name: string;
			readonly error: string;
			readonly code: string;
	  };

export function pluginSetupHasFailures(response: PluginSetupResponse): boolean {
	if (!response.ok) {
		return true;
	}
	return (response.actions ?? []).some(
		(action) => !action.ok && action.skipped !== true,
	);
}

export function formatPluginSetupActionLines(
	actions: readonly PluginSetupActionResult[],
): string[] {
	return actions.map((action) => {
		const status = action.skipped ? "skipped" : action.ok ? "ok" : "failed";
		const detail = action.detail ? ` — ${action.detail}` : "";
		return `${action.label} [${status}]${detail}`;
	});
}

export function resolveInstalledPluginBinary(name: string): string | null {
	const normalized = name.trim();
	const discovered = discoverPluginBinaries().find(
		(entry) => entry.binaryName === `toby-plugin-${normalized}`,
	);
	if (discovered) {
		return discovered.binaryPath;
	}
	const installPath = resolvePluginInstallTarget(normalized);
	return fs.existsSync(installPath) ? installPath : null;
}

export function runPluginSetup(name: string): PluginSetupRunResult {
	const normalized = name.trim();
	if (!normalized) {
		return {
			ok: false,
			name: normalized,
			error: "Plugin name is required",
			code: "invalid_name",
		};
	}

	const binaryPath = resolveInstalledPluginBinary(normalized);
	if (!binaryPath) {
		return {
			ok: false,
			name: normalized,
			error: `Plugin "${normalized}" is not installed`,
			code: "not_installed",
		};
	}

	const result = pluginSetup(binaryPath);
	if (!result.ok) {
		return {
			ok: false,
			name: normalized,
			error: result.error,
			code: result.code,
		};
	}

	if (!result.data.ok) {
		return {
			ok: false,
			name: normalized,
			error: result.data.error ?? "Plugin setup returned ok:false",
			code: result.data.code ?? "setup_failed",
		};
	}

	return {
		ok: true,
		name: normalized,
		binaryPath,
		response: result.data,
	};
}
