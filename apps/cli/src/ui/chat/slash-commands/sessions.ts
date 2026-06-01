import type { SlashCommand } from "./types";

export const sessionsSlashCommand: SlashCommand = {
	command: "/sessions",
	description: "Load a past chat session.",
	helpText: "Pick one of your 10 most recent saved sessions to load.",
	run(runtime) {
		runtime.openSessionsPicker();
	},
};
