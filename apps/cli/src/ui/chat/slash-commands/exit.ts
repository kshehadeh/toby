import type { SlashCommand } from "./types";

export const exitSlashCommand: SlashCommand = {
	command: "/exit",
	description: "Quit the chat session.",
	helpText: "Quit the chat session.",
	run(runtime) {
		runtime.exit();
	},
};
