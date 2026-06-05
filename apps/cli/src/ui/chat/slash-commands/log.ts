import type { SlashCommand } from "./types";

export const logSlashCommand: SlashCommand = {
	command: "/log",
	description: "Show recent log entries.",
	helpText:
		"Open a scrollable viewer for the last 50 entries from ~/.toby/toby.log.",
	run(runtime) {
		runtime.openLogViewer();
	},
};
