import type { SlashCommand } from "./types";

export const usageSlashCommand: SlashCommand = {
	command: "/usage",
	description: "Show provider and session usage.",
	helpText: "Open usage details for the active provider and chat session.",
	run(runtime) {
		runtime.openUsageViewer();
	},
};
