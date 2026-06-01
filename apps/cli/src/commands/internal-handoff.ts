import { spawn } from "node:child_process";
import process from "node:process";
import type { Command } from "commander";
import { applyStagedRelease, readStagingManifest } from "../upgrade/index";

interface HandoffOptions {
	watchPid: string;
	execPath: string;
	argsJson: string;
	applyStaged?: boolean;
	installTarget?: string;
}

const POLL_INTERVAL_MS = 200;
const MAX_WAIT_MS = 60_000;

export function registerInternalHandoffCommand(internal: Command): void {
	internal
		.command("handoff")
		.description(
			"Internal: wait for a process to exit, optionally apply upgrade, relaunch",
		)
		.requiredOption("--watch-pid <pid>", "PID to wait for before relaunching")
		.requiredOption("--exec-path <path>", "Executable path for relaunch")
		.requiredOption("--args-json <json>", "JSON array of CLI args for relaunch")
		.option("--apply-staged", "Apply staged upgrade before relaunch", false)
		.option(
			"--install-target <path>",
			"Override install target when applying staged upgrade",
		)
		.action(async (options: HandoffOptions) => {
			try {
				await runHandoff(options);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(message);
				process.exitCode = 1;
			}
		});
}

export function registerInternalCommands(program: Command): void {
	const internal = program
		.command("internal")
		.description("Internal commands (not intended for direct use)");
	registerInternalHandoffCommand(internal);
}

async function runHandoff(options: HandoffOptions): Promise<void> {
	const watchPid = Number.parseInt(options.watchPid, 10);
	if (!Number.isFinite(watchPid) || watchPid <= 0) {
		throw new Error(`Invalid watch PID: ${options.watchPid}`);
	}

	let relaunchArgs: string[];
	try {
		const parsed = JSON.parse(options.argsJson) as unknown;
		if (
			!Array.isArray(parsed) ||
			!parsed.every((item) => typeof item === "string")
		) {
			throw new Error("args-json must be a JSON string array");
		}
		relaunchArgs = parsed;
	} catch (error) {
		throw new Error(
			`Invalid --args-json: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	await waitForProcessExit(watchPid, MAX_WAIT_MS);

	if (options.applyStaged) {
		const manifest = await readStagingManifest();
		if (!manifest) {
			throw new Error("No staged upgrade manifest found.");
		}
		await applyStagedRelease(options.installTarget ?? manifest.installTarget);
	}

	await relaunchProcess(options.execPath, relaunchArgs);
}

export async function waitForProcessExit(
	pid: number,
	maxWaitMs: number,
): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < maxWaitMs) {
		if (!isProcessRunning(pid)) {
			return;
		}
		await sleep(POLL_INTERVAL_MS);
	}
	if (isProcessRunning(pid)) {
		throw new Error(`Timed out waiting for process ${pid} to exit.`);
	}
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code !== "ESRCH";
	}
}

async function relaunchProcess(
	execPath: string,
	args: string[],
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(execPath, args, {
			detached: true,
			stdio: "inherit",
			env: process.env,
		});
		child.on("error", reject);
		child.unref();
		resolve();
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
