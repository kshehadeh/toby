import { isDaemonRunning, stopDaemon } from "../../../schedules/daemon-status";
import type { SlashCommand } from "./types";

export const stopDaemonSlashCommand: SlashCommand = {
	command: "/stop-daemon",
	description: "Stop the running schedule daemon.",
	helpText: "Sends SIGTERM to the running daemon process.",
	run(runtime) {
		const { running, pid } = isDaemonRunning();
		if (!running) {
			runtime.addMetaLine("Daemon is not running.");
			return;
		}

		const success = stopDaemon();
		if (success) {
			runtime.addMetaLine(`Daemon stopped (was PID ${pid}).`);
		} else {
			runtime.addMetaLine(
				`Failed to stop daemon (PID ${pid}). You may need to kill it manually.`,
			);
		}
	},
};
