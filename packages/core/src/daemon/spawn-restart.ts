import { spawn } from "node:child_process";
import {
	buildTobySpawnArgs,
	getDetachedDaemonSpawnStdio,
	getTobyExecPath,
} from "../toby-spawn";

/** Spawn a detached `toby daemon restart` process. */
export function spawnDetachedDaemonRestart(): boolean {
	try {
		const child = spawn(
			getTobyExecPath(),
			buildTobySpawnArgs("daemon", "restart"),
			{
				detached: true,
				stdio: getDetachedDaemonSpawnStdio(),
			},
		);
		child.unref();
		return true;
	} catch {
		return false;
	}
}
