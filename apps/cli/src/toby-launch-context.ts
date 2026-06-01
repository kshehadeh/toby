import process from "node:process";
import {
	buildTobySpawnArgs,
	getTobyEntryScriptArgv,
	getTobyExecPath,
} from "./toby-spawn";
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

const ROOT_OPTIONS = new Set(["--help", "-h", "--version", "-V"]);

/** Subcommands registered on the root program (must stay in sync with cli.ts). */
const KNOWN_SUBCOMMANDS = new Set([
	"chat",
	"config",
	"configure",
	"connect",
	"disconnect",
	"daemon",
	"schedules",
	"sessions",
	"skills",
	"status",
	"upgrade",
	"internal",
]);

function normalizeLaunchCliArgs(cliArgs: readonly string[]): string[] {
	const args = [...cliArgs];
	const first = args[0];
	if (!first || (!KNOWN_SUBCOMMANDS.has(first) && !ROOT_OPTIONS.has(first))) {
		return ["chat", ...args];
	}
	return args;
}

export function captureLaunchContext(
	cliArgs: readonly string[] = process.argv.slice(2),
): LaunchContext {
	const normalized = normalizeLaunchCliArgs(cliArgs);
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
