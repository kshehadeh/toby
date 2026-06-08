import { spawn } from "node:child_process";
import fs from "node:fs";
import {
	buildTobySpawnArgs,
	getDetachedUpgradeSpawnStdio,
	getTobyExecPath,
} from "@toby/core/toby-spawn";
import type { LaunchContext } from "../toby-launch-context";
import { readStagingManifest, resolveStagedBinaryPath } from "./index";

export interface SpawnHandoffOptions {
	readonly launchContext: LaunchContext;
	readonly applyStaged: boolean;
}

export function resolveUpgradeHandoffSpawn(options: {
	readonly launchContext: LaunchContext;
	readonly applyStaged: boolean;
}): { readonly execPath: string; readonly args: string[] } {
	const { launchContext, applyStaged } = options;
	const rawHandoffArgs = [
		"internal",
		"handoff",
		"--watch-pid",
		String(launchContext.pid),
		"--exec-path",
		launchContext.execPath,
		"--args-json",
		JSON.stringify([...launchContext.args]),
	];
	if (applyStaged) {
		rawHandoffArgs.push("--apply-staged");
		rawHandoffArgs.push("--install-target", launchContext.installTarget);
	}

	const stagedPath = resolveStagedBinaryPath();
	const useStaged = applyStaged && fs.existsSync(stagedPath);
	const execPath = useStaged ? stagedPath : getTobyExecPath();
	return {
		execPath,
		args: useStaged ? rawHandoffArgs : buildTobySpawnArgs(...rawHandoffArgs),
	};
}

export function spawnUpgradeHandoff(options: SpawnHandoffOptions): void {
	const { execPath, args } = resolveUpgradeHandoffSpawn(options);
	const child = spawn(execPath, args, {
		detached: true,
		stdio: getDetachedUpgradeSpawnStdio(),
	});
	child.unref();
}

export async function hasStagedUpgradeReady(): Promise<boolean> {
	const manifest = await readStagingManifest();
	return manifest !== null;
}
