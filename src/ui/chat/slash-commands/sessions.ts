import type { SlashCommand } from "./types";

export const sessionsSlashCommand: SlashCommand = {
	command: "/sessions",
	description: "Load a past chat session.",
	helpText: "Pick a saved session to load into memory.",
	run(runtime) {
		runtime.openSessionsPicker();
	},
};
