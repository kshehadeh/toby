import { ensureDaemonRunning, isDaemonRunning } from "../../../schedules/daemon-status";
import type { SlashCommand } from "./types";

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
			runtime.addNoticeLine("Starting daemon…", "info");
			const result = await ensureDaemonRunning();
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
