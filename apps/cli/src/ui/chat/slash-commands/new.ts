import type { SlashCommand } from "./types";

export const newSlashCommand: SlashCommand = {
	command: "/new",
	description: "Start a new chat session.",
	helpText: "Start a new chat session (clears current context).",
	run(runtime) {
		runtime.startNewSession();
	},
};
