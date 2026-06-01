import { getIntegration, getIntegrations } from "@toby/core/integrations/index";
import type { SlashCommand } from "./types";

export const disconnectSlashCommand: SlashCommand = {
	command: "/disconnect",
	description: "Disconnect an integration, or list all connected integrations.",
	helpText:
		"Disconnect an integration by name (e.g. /disconnect gmail). Run without arguments to list connected integrations.",
	async run(runtime, rawArgs) {
		const name = rawArgs?.trim();

		if (!name) {
			const integrations = getIntegrations();
			const connectedNames: string[] = [];
			for (const i of integrations) {
				if (await i.isConnected()) {
					connectedNames.push(i.displayName);
				}
			}
			if (connectedNames.length === 0) {
				runtime.addMetaLine("No integrations are currently connected.");
			} else {
				for (const n of connectedNames) {
					runtime.addMetaLine(`  ${n}  connected`);
				}
			}
			runtime.addMetaLine(
				"Run /disconnect <name> to disconnect an integration.",
			);
			return;
		}

		const integration = getIntegration(name);
		if (!integration) {
			runtime.addMetaLine(`Unknown integration: ${name}`);
			runtime.addMetaLine("Run /disconnect to see connected integrations.");
			return;
		}

		const connected = await integration.isConnected();
		if (!connected) {
			runtime.addMetaLine(`${integration.displayName} is not connected.`);
			return;
		}

		try {
			await integration.disconnect();
			runtime.addMetaLine(
				`${integration.displayName} disconnected successfully.`,
			);
		} catch (e) {
			runtime.addMetaLine(
				`Failed to disconnect ${integration.displayName}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	},
};
