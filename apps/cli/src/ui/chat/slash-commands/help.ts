import type { SlashCommand } from "./types";

export const helpSlashCommand: SlashCommand = {
	command: "/help",
	description: "Show chat help.",
	helpText: "Show slash commands and keyboard shortcuts.",
	run(runtime) {
		runtime.openHelp();
	},
};
