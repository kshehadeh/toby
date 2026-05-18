import type { SlashCommand } from "./types";

export const helpSlashCommand: SlashCommand = {
	command: "/help",
	description: "Show chat help.",
	helpText: "Show slash commands (press ? with an empty prompt for shortcuts).",
	run(runtime) {
		runtime.openHelp();
	},
};
