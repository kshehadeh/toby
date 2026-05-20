import { spawn } from "node:child_process";
import type { LaunchContext } from "../toby-launch-context";
import {
	buildTobySpawnArgs,
	getDetachedUpgradeSpawnStdio,
	getTobyExecPath,
} from "../toby-spawn";
import { readStagingManifest } from "./index";

export interface SpawnHandoffOptions {
	readonly launchContext: LaunchContext;
	readonly applyStaged: boolean;
}

export function spawnUpgradeHandoff(options: SpawnHandoffOptions): void {
	const { launchContext, applyStaged } = options;
	const handoffArgs = buildTobySpawnArgs(
		"internal",
		"handoff",
		"--watch-pid",
		String(launchContext.pid),
		"--exec-path",
		launchContext.execPath,
		"--args-json",
		JSON.stringify([...launchContext.args]),
	);
	if (applyStaged) {
		handoffArgs.push("--apply-staged");
		handoffArgs.push("--install-target", launchContext.installTarget);
	}

	const child = spawn(getTobyExecPath(), handoffArgs, {
		detached: true,
		stdio: getDetachedUpgradeSpawnStdio(),
	});
	child.unref();
}

export async function hasStagedUpgradeReady(): Promise<boolean> {
	const manifest = await readStagingManifest();
	return manifest !== null;
}
