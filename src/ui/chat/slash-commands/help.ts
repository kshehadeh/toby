import type { SlashCommand } from "./types";

export const helpSlashCommand: SlashCommand = {
	command: "/help",
	description: "Show chat help.",
	helpText: "Show this screen.",
	run(runtime) {
		runtime.openHelp();
	},
};
