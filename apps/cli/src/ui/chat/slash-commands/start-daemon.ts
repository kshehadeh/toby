import { spawn } from "node:child_process";
import {
	buildTobySpawnArgs,
	getDetachedDaemonSpawnStdio,
	getTobyExecPath,
} from "@toby/core/toby-spawn";
import { isDaemonRunning } from "../../../schedules/daemon-status";
import type { SlashCommand } from "./types";

async function waitForDaemon(
	maxAttempts = 10,
	intervalMs = 300,
): Promise<{ running: boolean; pid: number | null }> {
	for (let i = 0; i < maxAttempts; i++) {
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
		const check = isDaemonRunning();
		if (check.running) {
			return check;
		}
	}
	return { running: false, pid: null };
}

export const startDaemonSlashCommand: SlashCommand = {
	command: "/start-daemon",
	description: "Start the schedule daemon in the background.",
	helpText:
		"Spawns `toby daemon start` as a detached background process. Schedules will run automatically.",
	async run(runtime) {
		const { running, pid } = isDaemonRunning();
		if (running) {
			runtime.addNoticeLine(`Daemon is already running (PID ${pid}).`, "info");
			return;
		}

		try {
			const child = spawn(
				getTobyExecPath(),
				buildTobySpawnArgs("daemon", "start"),
				{
					detached: true,
					stdio: getDetachedDaemonSpawnStdio(),
				},
			);
			child.unref();

			runtime.addNoticeLine("Starting daemon…", "info");

			const result = await waitForDaemon();
			if (result.running) {
				runtime.addNoticeLine(`Daemon started (PID ${result.pid}).`, "success");
			} else {
				runtime.addNoticeLine(
					"Daemon process was spawned but did not start within the expected time. Try running `toby daemon run` directly.",
					"error",
				);
			}
		} catch (e) {
			runtime.addNoticeLine(
				`Failed to start daemon: ${e instanceof Error ? e.message : String(e)}`,
				"error",
			);
		}
	},
};
