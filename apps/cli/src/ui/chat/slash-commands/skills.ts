import type { SlashCommand } from "./types";

export const skillsSlashCommand: SlashCommand = {
	command: "/skills",
	description: "Open configuration with Skills selected.",
	helpText: "View, edit, and delete local skills in Configuration.",
	run(runtime) {
		runtime.openSkills();
	},
};
