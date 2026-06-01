import type { SlashCommand } from "./types";

export const schedulesSlashCommand: SlashCommand = {
	command: "/schedules",
	description: "Open schedules management view.",
	helpText: "View, create, edit, and delete scheduled tasks.",
	run(runtime) {
		runtime.openSchedules();
	},
};
