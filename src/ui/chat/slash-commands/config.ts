import type { SlashCommand } from "./types";

export const configSlashCommand: SlashCommand = {
	command: "/config",
	description: "Open configuration view.",
	helpText: "Open configuration to edit integrations, AI, and personas.",
	run(runtime) {
		runtime.openConfig();
	},
};
