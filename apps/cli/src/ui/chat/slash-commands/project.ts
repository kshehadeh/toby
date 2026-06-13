import type { SlashCommand } from "./types";

export const projectSlashCommand: SlashCommand = {
	command: "/project",
	description: "Choose, create, or clear the active project.",
	helpText:
		"Open the project list (Enter select · e edit · Esc cancel). Selecting a project activates it for the current session.",
	run(runtime) {
		runtime.openProjectPicker();
	},
};
