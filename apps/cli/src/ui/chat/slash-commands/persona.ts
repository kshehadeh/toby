import type { SlashCommand } from "./types";

export const personaSlashCommand: SlashCommand = {
	command: "/persona",
	description: "Choose or edit the active persona.",
	helpText:
		"Open the persona list (Enter select · e edit · Esc cancel). Add creates a new persona in configure.",
	run(runtime) {
		runtime.openPersonaPicker();
	},
};
