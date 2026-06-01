import type { SlashCommand } from "./types";

export const skillsSlashCommand: SlashCommand = {
	command: "/skills",
	description: "Open skills management view.",
	helpText: "View, edit, and delete local skills.",
	run(runtime) {
		runtime.openSkills();
	},
};
