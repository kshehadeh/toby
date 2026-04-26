import type { SlashCommand } from "./types";

export const integrationSlashCommand: SlashCommand = {
	command: "/integration",
	description: "Choose active integrations.",
	helpText:
		"Choose which integrations are active (Space toggles, Enter applies). Resets session context for the new selection.",
	run(runtime) {
		if (runtime.chatIntegrationsCount === 0) {
			runtime.addMetaLine("No chat integrations available.");
			return;
		}
		runtime.openIntegrationPicker();
	},
};
