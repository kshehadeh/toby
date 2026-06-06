import { isDaemonRunning, stopDaemon } from "../../../schedules/daemon-status";
import type { SlashCommand } from "./types";

export const stopDaemonSlashCommand: SlashCommand = {
	command: "/stop-daemon",
	description: "Stop the running schedule daemon.",
	helpText: "Sends SIGTERM to the running daemon process.",
	run(runtime) {
		const { running, pid } = isDaemonRunning();
		if (!running) {
			runtime.addNoticeLine("Daemon is not running.", "info");
			return;
		}

		const success = stopDaemon();
		if (success) {
			runtime.addNoticeLine(`Daemon stopped (was PID ${pid}).`, "success");
		} else {
			runtime.addNoticeLine(
				`Failed to stop daemon (PID ${pid}). You may need to kill it manually.`,
				"error",
			);
		}
	},
};
