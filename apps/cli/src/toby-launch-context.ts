import process from "node:process";
import {
	buildTobySpawnArgs,
	getTobyEntryScriptArgv,
	getTobyExecPath,
} from "@toby/core/toby-spawn";
import { normalizeRootCliArgs } from "./cli-args";
import {
	isRunningAsCompiledBinary,
	resolveInstallTarget,
} from "./upgrade/index";

export interface LaunchContext {
	readonly execPath: string;
	readonly args: readonly string[];
	readonly compiled: boolean;
	readonly installTarget: string;
	readonly pid: number;
}

export function captureLaunchContext(
	cliArgs: readonly string[] = process.argv.slice(2),
): LaunchContext {
	const normalized = normalizeRootCliArgs(cliArgs);
	return {
		execPath: getTobyExecPath(),
		args: buildTobySpawnArgs(...normalized),
		compiled: isRunningAsCompiledBinary(),
		installTarget: resolveInstallTarget(),
		pid: process.pid,
	};
}

export function isScriptLaunch(): boolean {
	return getTobyEntryScriptArgv() !== null;
}
