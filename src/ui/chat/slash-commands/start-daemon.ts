import { spawn } from "node:child_process";
import { isDaemonRunning } from "../../../schedules/daemon-status";
import { buildTobySpawnArgs, getTobyExecPath } from "../../../toby-spawn";
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
			runtime.addMetaLine(`Daemon is already running (PID ${pid}).`);
			return;
		}

		try {
			const child = spawn(getTobyExecPath(), buildTobySpawnArgs("daemon", "start"), {
				detached: true,
				stdio: "ignore",
			});
			child.unref();

			runtime.addMetaLine("Starting daemon…");

			const result = await waitForDaemon();
			if (result.running) {
				runtime.addMetaLine(`Daemon started (PID ${result.pid}).`);
			} else {
				runtime.addMetaLine(
					"Daemon process was spawned but did not start within the expected time. Try running `toby daemon run` directly.",
				);
			}
		} catch (e) {
			runtime.addMetaLine(
				`Failed to start daemon: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	},
};
